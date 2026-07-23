#!/usr/bin/env bun
// M3 评审流水线：真实会话 → 隔离账本 → 真实蒸馏（haiku）→ 评审表。
// 用法: bun scripts/eval.ts <transcript.jsonl...>   产出 eval/M3-评审表.md
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const EVAL = join(ROOT, "eval");
const CLI = join(ROOT, "packages/cli/src/main.ts");
const transcripts = process.argv.slice(2);
if (!transcripts.length) {
  console.error("用法: bun scripts/eval.ts <transcript.jsonl...>");
  process.exit(1);
}

async function run(cmd: string[], env: Record<string, string | undefined>) {
  const proc = Bun.spawn(cmd, { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return { out, err, code: proc.exitCode };
}

interface Sample {
  i: number;
  transcript: string;
  project: string;
  session: string;
  writes: number;
  paths: number;
  entries: any[];
  bodies: Record<string, string>;
  error?: string;
  seconds: number;
}

async function evalOne(transcript: string, i: number): Promise<Sample> {
  const t0 = Date.now();
  const home = join(EVAL, "homes", String(i));
  const ledger = join(home, "ledger");
  // 已有产出的样本直接复用（增量评审）；--force 全部重跑
  const cached = !process.argv.includes("--force") &&
    existsSync(join(ledger, "manifests.jsonl")) &&
    readFileSync(join(ledger, "manifests.jsonl"), "utf8").trim().length > 0;
  if (!cached) {
    rmSync(home, { recursive: true, force: true });
    mkdirSync(home, { recursive: true });
  }
  const env = { STILLYOU_HOME: home, CLAUDE_SETTINGS: join(home, "settings.json"), STILLYOU_DEBUG: "1" };
  const project = basename(transcript).startsWith("agent-")
    ? "subagent"
    : basename(join(transcript, "..")).replace(/^-Users-kk-/, "");

  const sampleDir = join(EVAL, "samples", String(i));
  await run(["bun", join(ROOT, "scripts/harvest.ts"), transcript, sampleDir], {});
  const journalLines = readFileSync(join(sampleDir, "journal.jsonl"), "utf8")
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const session = journalLines[0]?.session ?? "unknown";
  const paths = new Set(journalLines.map((j: any) => j.path)).size;

  let distill = { err: "" };
  if (!cached) {
    await run(["bun", CLI, "init", "--yes", "--ledger", ledger], env);
    mkdirSync(join(ledger, "journal"), { recursive: true });
    cpSync(join(sampleDir, "journal.jsonl"), join(ledger, "journal", `${session}.jsonl`));
    distill = await run(
      ["bun", CLI, "distill", "--session", session, "--transcript", transcript],
      env,
    );
  }

  const entries = existsSync(join(ledger, "manifests.jsonl"))
    ? readFileSync(join(ledger, "manifests.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const bodies: Record<string, string> = {};
  const entriesDir = join(ledger, "entries");
  if (existsSync(entriesDir)) {
    for (const f of readdirSync(entriesDir)) {
      bodies[f.replace(".md", "")] = readFileSync(join(entriesDir, f), "utf8");
    }
  }
  return {
    i, transcript, project, session, writes: journalLines.length, paths,
    entries, bodies,
    error: distill.err.trim() || undefined,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
}

// 并发 3，别把 claude 登录打爆
const results: Sample[] = [];
let cursor = 0;
async function worker() {
  while (cursor < transcripts.length) {
    const i = cursor++;
    console.log(`[${i + 1}/${transcripts.length}] ${transcripts[i]}`);
    results.push(await evalOne(transcripts[i]!, i + 1));
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
results.sort((a, b) => a.i - b.i);

// 评审表
const lines: string[] = [
  `# M3 蒸馏质量评审表`,
  ``,
  `生成于 ${new Date().toISOString().slice(0, 16)}，模型 haiku。`,
  ``,
  `**怎么评**：看每个样本的蒸馏产出是否配得上"值得跨会话留存"——交付物挑对了吗（不是中间产物）？结论/决策是那个会话真正的沉淀吗？summary 拿来当检索键够不够用？`,
  `整体印象合格就在「评审」行打 ✓。判据：10 个样本 ≥8 个通过。`,
  ``,
];
for (const s of results) {
  lines.push(`---`, ``, `## 样本 ${s.i}：${s.project}`);
  lines.push(`会话 \`${s.session.slice(0, 8)}\` · 写入 ${s.writes} 次 / ${s.paths} 个文件 · 蒸馏 ${s.seconds}s`);
  if (s.error) lines.push(``, `⚠ 蒸馏报错：\`${s.error.slice(0, 200)}\``);
  if (!s.entries.length) {
    lines.push(``, `（零产出——判断这个会话确实没有值得留存的东西吗？）`);
  }
  for (const e of s.entries) {
    lines.push(``, `- **${e.type}** \`${e.coords.name}\`：${e.summary}`);
    if (e.path) lines.push(`  - 文件：\`${e.path}\``);
    const body = s.bodies[e.id];
    if (body) {
      lines.push(`  - 正文：`);
      for (const bl of body.trim().split("\n")) lines.push(`    > ${bl}`);
    }
  }
  lines.push(``, `**评审**：[ ] 通过 [ ] 不通过　备注：`);
}
const passTarget = Math.ceil(results.length * 0.8);
lines.push(``, `---`, ``, `**汇总**：___ / ${results.length} 通过（判据 ≥${passTarget}）`);

mkdirSync(EVAL, { recursive: true });
const sheet = join(EVAL, "M3-评审表.md");
writeFileSync(sheet, lines.join("\n") + "\n");
console.log(`\n评审表：${sheet}`);
console.log(`产出统计：${results.map((s) => `样本${s.i}=${s.entries.length}条`).join(" ")}`);

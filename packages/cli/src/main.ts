#!/usr/bin/env bun
// akm CLI 薄壳：所有逻辑在 @akm/core，这里只做命令路由与 stdin/stdout。
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync, readdirSync } from "node:fs";
import {
  appendJournal,
  appendManifests,
  buildHydrationContext,
  CACHE_DIR,
  AKM_HOME,
  ClaudeCliProvider,
  condenseTranscript,
  CONFIG_PATH,
  DEFAULT_LEDGER,
  discoverProject,
  distillSession,
  entryBodyAbsPath,
  retireReplaced,
  writeEntryBody,
  type Entry,
  DistillResult,
  initLedger,
  installClaudeHooks,
  INDEX_PATH,
  JournalLine,
  ledgerPaths,
  loadConfig,
  MockProvider,
  readJournal,
  readManifests,
  rebuildIndex,
  recordAccess,
  search,
  writeProjectMarker,
  type Config,
  type Provider,
} from "@akm/core";

const CLAUDE_SETTINGS =
  process.env.CLAUDE_SETTINGS ?? join(homedir(), ".claude", "settings.json");

function selfCmd(): string {
  // 编译后的单二进制 Bun.main 在虚拟文件系统里；开发期用 bun 跑源码。
  // 路径含空格必须加引号——hook 命令静默失效是卸载导火索
  const q = (p: string) => (p.includes(" ") ? `"${p}"` : p);
  return Bun.main.startsWith("/$bunfs") ? q(process.execPath) : `bun ${q(Bun.main)}`;
}

// session id 会拼进文件名：只接受受信形状（UUID/字母数字），异常输入直接不处理
function validSession(s: unknown): s is string {
  return typeof s === "string" && /^[\w.-]+$/.test(s);
}

async function readStdinJson(): Promise<any> {
  const text = await Bun.stdin.text();
  return text.trim() ? JSON.parse(text) : {};
}

function arg(flags: string[], name: string): string | undefined {
  const i = flags.indexOf(name);
  return i >= 0 ? flags[i + 1] : undefined;
}

function makeProvider(): Provider {
  // 测试注入：AKM_PROVIDER=mock + AKM_MOCK_JSON=<file>
  if (process.env.AKM_PROVIDER === "mock") {
    const mock = process.env.AKM_MOCK_JSON
      ? JSON.parse(readFileSync(process.env.AKM_MOCK_JSON, "utf8"))
      : {};
    const { CompactResult } = require("@akm/core");
    return new MockProvider(
      DistillResult.parse(mock.distill ?? { items: [] }),
      mock.judge ?? "unsure",
      CompactResult.parse(mock.compact ?? { clusters: [] }),
    );
  }
  return new ClaudeCliProvider(process.env.AKM_MODEL ?? "haiku");
}

function requireConfig(): Config {
  const config = loadConfig();
  if (!config) {
    console.error("akm 未初始化，先跑 `akm init`");
    process.exit(1);
  }
  return config;
}

// ---- commands ----

async function cmdInit(flags: string[]) {
  if (flags.includes("--project")) {
    const name = arg(flags, "--project") ?? process.cwd().split("/").pop()!;
    const path = writeProjectMarker(process.cwd(), name);
    console.log(`项目标记已写入 ${path}（project: ${name}）`);
    return;
  }
  let ledger = arg(flags, "--ledger") ?? DEFAULT_LEDGER;
  if (!arg(flags, "--ledger") && !flags.includes("--yes") && process.stdin.isTTY) {
    const rl = require("node:readline/promises").createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = (await rl.question(`账本位置 [${DEFAULT_LEDGER}]: `)).trim();
    rl.close();
    if (answer) ledger = answer;
  }
  const config = initLedger(ledger);
  installClaudeHooks(CLAUDE_SETTINGS, selfCmd());
  rebuildIndex(config.ledger);
  console.log(`账本已建：${config.ledger}`);
  console.log(`配置已写：${CONFIG_PATH}`);
  console.log(`Claude Code hooks 已注册：${CLAUDE_SETTINGS}（capture/distill/hydrate）`);
  console.log(`提示：项目目录里跑 \`akm init --project\` 可启用项目作用域。`);
}

// PostToolUse hook：零 LLM，静默失败，不阻塞宿主——关键路径上的代码必须笨
async function cmdCapture() {
  try {
    if (process.env.AKM_DISTILLING) return;
    const config = loadConfig();
    if (!config) return;
    const input = await readStdinJson();
    const path: string | undefined =
      input?.tool_input?.file_path ?? input?.tool_input?.notebook_path;
    if (!path || !validSession(input.session_id)) return;
    // 账本与缓存自身的写入不记录，避免自反馈（精确前缀匹配，不误伤路径里碰巧含 .akm 的文件）
    if (
      path === config.ledger || path.startsWith(config.ledger + "/") ||
      path === AKM_HOME || path.startsWith(AKM_HOME + "/") ||
      basename(path) === ".akm"
    ) return;
    appendJournal(config.ledger, JournalLine.parse({
      ts: new Date().toISOString(),
      session: input.session_id,
      host: "claude-code",
      cwd: input.cwd ?? process.cwd(),
      tool: input.tool_name ?? "unknown",
      path,
      hash: fileHash(path),
    }));
  } catch {
    // 静默：capture 永不打扰宿主
  }
}

function fileHash(path: string): string | undefined {
  try {
    // ponytail: >4MB 不哈希（性能预算 <10ms），大文件靠路径+时间戳辨识
    if (statSync(path).size > 4 * 1024 * 1024) return undefined;
    return "sha256:" + createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
  } catch {
    return undefined;
  }
}

// Stop/SessionEnd hook：读 journal + 会话记录，蒸馏入账。失败静默——蒸馏丢一次不伤账本。
// 交互式会话每回合都触发 Stop：journal 没长就跳过；重蒸同一会话 = 整批替换旧产出（重算，非增量）。
async function cmdDistill(flags: string[]) {
  let sessionRef = "";
  try {
    if (process.env.AKM_DISTILLING) return; // 防 claude -p 递归
    const config = loadConfig();
    if (!config) return;
    const input = await readStdinJson();
    const session: string | undefined = input.session_id ?? arg(flags, "--session");
    if (!session || !validSession(session)) return;
    sessionRef = session;
    const journal = readJournal(config.ledger, session);
    // ponytail: 只蒸馏写过文件的会话；纯对话会话的结论蒸馏等真实需求出现再开
    if (!journal.length) return;
    const stateFile = join(CACHE_DIR, "distill-state.json");
    let state: Record<string, { lines: number; at?: number }> = {};
    try { state = JSON.parse(readFileSync(stateFile, "utf8")); } catch {}
    if (state[session]?.lines === journal.length && !flags.includes("--force")) return;
    // 防抖（Stop 每回合都触发）：增量小且离上次近就等一等；SessionEnd 不带此 flag，必蒸
    if (flags.includes("--debounce") && !flags.includes("--force")) {
      const st = state[session];
      if (st && journal.length - st.lines < 5 && Date.now() - (st.at ?? 0) < 15 * 60_000) return;
    }
    const transcriptPath: string | undefined = input.transcript_path ?? arg(flags, "--transcript");
    const cwd: string = input.cwd ?? arg(flags, "--cwd") ?? journal[0]!.cwd;

    // hook 模式秒退：重活派给脱离的后台进程，宿主回合收尾零等待
    if (flags.includes("--detach")) {
      const argv = Bun.main.startsWith("/$bunfs") ? [process.execPath] : ["bun", Bun.main];
      const child = Bun.spawn(
        [...argv, "distill", "--session", session, "--cwd", cwd,
          ...(transcriptPath ? ["--transcript", transcriptPath] : []),
          ...(flags.includes("--force") ? ["--force"] : [])],
        { stdin: "ignore", stdout: "ignore", stderr: "ignore", env: process.env as Record<string, string> },
      );
      child.unref();
      return;
    }

    // 同会话蒸馏互斥：原子创建（wx），拿不到锁就让位；10 分钟以上视为死锁残留清掉重试
    const lock = join(CACHE_DIR, `distill-${session}.lock`);
    try {
      writeFileSync(lock, String(process.pid), { flag: "wx" });
    } catch {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 10 * 60_000) {
          unlinkSync(lock);
          writeFileSync(lock, String(process.pid), { flag: "wx" });
        } else return;
      } catch {
        return;
      }
    }
    try {
    const transcriptSummary = transcriptPath ? condenseTranscript(transcriptPath) : "";
    const project = discoverProject(cwd)?.project;
    const all = readManifests(config.ledger);
    const prior = [...all.values()].filter(
      (e) => e.provenance.session === session && e.status !== "superseded",
    );
    // 取代判定只对别的会话的条目做；本会话旧产出走整批替换
    const others = new Map([...all].filter(([, e]) => e.provenance.session !== session));
    const { entries, bodies } = await distillSession({
      session,
      host: "claude-code",
      now: new Date().toISOString(),
      journal,
      transcriptSummary,
      project,
      existing: others,
      allEntries: all,
      provider: makeProvider(),
      model: process.env.AKM_MODEL ?? "haiku",
    });
    if (!entries.length) return;
    const retired = retireReplaced(prior, entries);
    const paths = ledgerPaths(config.ledger);
    // 正文按坐标落盘：entries/<ns>/<name>/v<N>-<id8>.md，manifest 记相对路径
    const withBodies = entries.map((e) =>
      bodies[e.id] !== undefined && e.status !== "superseded"
        ? writeEntryBody(config.ledger, e, bodies[e.id]!)
        : e,
    );
    // 蒸馏依据归档进账本：宿主 30 天后清理会话记录，溯源不能跟着断链（明文摘录，config 可关）
    if (transcriptSummary && config.archive_transcripts) {
      writeFileSync(join(paths.journalDir, `${session}.transcript.md`), transcriptSummary + "\n");
    }
    appendManifests(config.ledger, [...withBodies, ...retired]);
    rebuildIndex(config.ledger);
    try {
      state[session] = { lines: journal.length, at: Date.now() };
      writeFileSync(stateFile, JSON.stringify(state));
    } catch {}
    if (process.stdout.isTTY) console.log(`蒸馏入账 ${entries.length} 条${retired.length ? `，替换旧产出 ${retired.length} 条` : ""}`);
    } finally {
      try { unlinkSync(lock); } catch {}
    }
  } catch (err) {
    // 静默不阻塞宿主，但命门不能坏得无声：失败落痕，status 会提醒
    try {
      writeFileSync(join(CACHE_DIR, "last-distill-error.json"), JSON.stringify({
        session: sessionRef,
        at: new Date().toISOString(),
        error: String(err).split("\n")[0],
      }));
    } catch {}
    if (process.env.AKM_DEBUG) console.error("[akm distill]", err);
  }
}

async function cmdSearch(flags: string[]) {
  const config = requireConfig();
  const query = flags.filter((f) => !f.startsWith("--")).join(" ");
  const hits = search({
    query,
    project: discoverProject(process.cwd())?.project,
    includeSuperseded: flags.includes("--all"),
    limit: Number(arg(flags, "--limit") ?? 10),
    staleDays: config.stale_days,
  });
  if (!hits.length) {
    console.log("（无结果）");
    return;
  }
  for (const h of hits) {
    console.log(
      `- [${h.id}] ${h.name}@v${h.version} (${h.type}/${h.status}${h.stale ? "/stale" : ""}, ${h.created.slice(0, 10)}${h.verified ? ", verified" : ""}) ${h.summary}`,
    );
  }
  console.log(`\n用 \`akm get <id>\` 看全文与溯源`);
}

async function cmdGet(flags: string[]) {
  const config = requireConfig();
  const id = flags.find((f) => !f.startsWith("--"));
  if (!id) return console.log("用法: akm get <id>");
  const entry = readManifests(config.ledger).get(id);
  if (!entry) return console.log(`条目不存在: ${id}`);
  recordAccess(id); // 被采用即强化——用进废退
  console.log(`# ${entry.coords.namespace}/${entry.coords.name}@v${entry.coords.version}`);
  console.log(JSON.stringify(entry, null, 2));
  const bodyPath = entryBodyAbsPath(config.ledger, entry);
  if (existsSync(bodyPath)) {
    console.log(`\n## 正文\n${readFileSync(bodyPath, "utf8")}`);
  }
  const archived = join(ledgerPaths(config.ledger).journalDir, `${entry.provenance.session}.transcript.md`);
  if (existsSync(archived)) {
    console.log(`\n## 溯源\n会话记录归档：${archived}`);
  }
  if (entry.path && existsSync(entry.path)) {
    console.log(`\n## 文件\n${entry.path}（存在，可直接读取）`);
  } else if (entry.path) {
    console.log(`\n## 文件\n${entry.path}（原路径已不存在，内容哈希 ${entry.content_hash ?? "未知"}）`);
  }
}

async function cmdRebuild() {
  const config = requireConfig();
  const n = rebuildIndex(config.ledger);
  console.log(`索引已重建：${n} 条（${INDEX_PATH}）`);
}

// 旧扁平正文 → 坐标目录。旧文件保留（真相层不做破坏性操作），manifest 追加带 body 字段的新行
async function cmdMigrate() {
  const config = requireConfig();
  const all = readManifests(config.ledger);
  const updated: Entry[] = [];
  for (const e of all.values()) {
    if (e.body) continue;
    const oldPath = join(ledgerPaths(config.ledger).entriesDir, `${e.id}.md`);
    if (!existsSync(oldPath)) continue;
    updated.push(writeEntryBody(config.ledger, e, readFileSync(oldPath, "utf8").replace(/\n$/, "")));
  }
  if (updated.length) {
    appendManifests(config.ledger, updated);
    rebuildIndex(config.ledger);
  }
  console.log(`迁移完成：${updated.length} 个正文按坐标落盘（entries/<namespace>/<name>/，旧文件保留作历史）。`);
}

// 账本压实：合并同主题条目。手动触发——自动合并的成本和惊吓都不可控
async function cmdCompact(flags: string[]) {
  const config = requireConfig();
  const { compactLedger } = await import("@akm/core");
  const all = readManifests(config.ledger);
  const bodyOf = (id: string) => {
    const e = all.get(id);
    if (!e) return undefined;
    const p = entryBodyAbsPath(config.ledger, e);
    return existsSync(p) ? readFileSync(p, "utf8") : undefined;
  };
  console.log(`分析 ${[...all.values()].filter((e) => e.status !== "superseded" && e.status !== "quarantined").length} 条活跃条目…`);
  const { fresh, retired, bodies } = await compactLedger({
    now: new Date().toISOString(),
    entries: all,
    bodyOf,
    provider: makeProvider(),
  });
  if (!fresh.length) {
    console.log("没有可合并的条目簇（拿不准的不合并）。");
    return;
  }
  for (const m of fresh) {
    console.log(`\n合并 ${m.provenance.inputs.length} 条 → [${m.id}] ${m.coords.name}`);
    console.log(`  ${m.summary}`);
    for (const src of m.provenance.inputs) {
      const e = all.get(src);
      console.log(`  ← [${src}] ${e?.coords.name ?? "?"}`);
    }
  }
  if (flags.includes("--dry")) {
    console.log(`\n（--dry 试运行，未写入）`);
    return;
  }
  const freshWithBodies = fresh.map((m) =>
    bodies[m.id] !== undefined ? writeEntryBody(config.ledger, m, bodies[m.id]!) : m,
  );
  appendManifests(config.ledger, [...freshWithBodies, ...retired]);
  rebuildIndex(config.ledger);
  console.log(`\n压实完成：${retired.length} 条来源转 superseded，新增 ${fresh.length} 条合并产物。`);
}

// 矛盾检测：找出账本里事实上互相打架的条目对。手动触发（要调 LLM，status 不能背这个成本）。
// 只报告——绝不自动改状态。结果缓存供 status 提示。
async function cmdConflicts() {
  const config = requireConfig();
  const { findConflicts } = await import("@akm/core");
  const all = readManifests(config.ledger);
  const bodyOf = (id: string) => {
    const e = all.get(id);
    if (!e) return undefined;
    const p = entryBodyAbsPath(config.ledger, e);
    return existsSync(p) ? readFileSync(p, "utf8") : undefined;
  };
  const reports = await findConflicts({ entries: all, bodyOf, provider: makeProvider() });
  // 缓存给 status 用（和 last-distill-error.json 同一套路）
  try {
    writeFileSync(join(CACHE_DIR, "last-conflicts.json"), JSON.stringify({
      at: new Date().toISOString(), count: reports.length,
    }));
  } catch {}
  if (!reports.length) {
    console.log("没发现事实矛盾的条目对（拿不准的不报）。");
    return;
  }
  console.log(`发现 ${reports.length} 对疑似矛盾（只报告，不自动改动——你来定夺：verify 一方 / 手动 supersede / 无视）：\n`);
  for (const r of reports) {
    const v = (e: typeof r.a) => e.verified_by.length ? " ✓已验证" : "";
    console.log(`⚠ ${r.why}`);
    console.log(`  [${r.a.id}] ${r.a.coords.name}${v(r.a)} — ${r.a.summary}`);
    console.log(`  [${r.b.id}] ${r.b.coords.name}${v(r.b)} — ${r.b.summary}\n`);
  }
}

// 会话导出：jsonl → 可读 markdown（对话全文 + 文件写入标记）
async function cmdExport(flags: string[]) {
  const target = flags.find((f) => !f.startsWith("--"));
  if (!target) return console.log("用法: akm export <会话id|jsonl路径> [--out <文件>]");
  const { renderTranscript } = await import("@akm/core");
  let path = target;
  if (!existsSync(path)) {
    // 按会话 id 在 ~/.claude/projects 里找
    const projectsDir = join(homedir(), ".claude", "projects");
    const hit = existsSync(projectsDir)
      ? readdirSync(projectsDir)
          .map((d) => join(projectsDir, d, `${target}.jsonl`))
          .find((p) => existsSync(p))
      : undefined;
    if (!hit) return console.log(`找不到会话 ${target}（查了 ${projectsDir}）`);
    path = hit;
  }
  const md = renderTranscript(path);
  const out = arg(flags, "--out");
  if (out) {
    writeFileSync(out, md);
    console.log(`已导出：${out}`);
  } else {
    console.log(md);
  }
}

// 水合是拉模型：SessionStart 只注入偏好常驻 + 账本导览；
// UserPromptSubmit（会话首条消息）用消息文本做纯本地相关性检索——这才是"按相关性注入"
async function cmdHydrate() {
  try {
    if (process.env.AKM_DISTILLING) return;
    const config = loadConfig();
    if (!config) return;
    const input = await readStdinJson();
    const eventName: string = input.hook_event_name ?? "SessionStart";
    const session: string = input.session_id ?? "";
    const project = discoverProject(input.cwd ?? process.cwd())?.project;
    let context = "";

    if (typeof input.prompt === "string" && input.prompt.trim()) {
      // 每会话只注入一次相关性结果，后续消息毫秒级直退
      const hstateFile = join(CACHE_DIR, "hydrate-state.json");
      let hstate: Record<string, boolean> = {};
      try { hstate = JSON.parse(readFileSync(hstateFile, "utf8")); } catch {}
      if (session && hstate[session]) return;
      const { promptToTokens } = await import("@akm/core");
      const hits = search({
        anyTokens: promptToTokens(input.prompt.slice(0, 400)),
        project,
        limit: 8,
        staleDays: config.stale_days,
      }).filter((h) => h.type !== "preference"); // 偏好开场已注入
      context = buildHydrationContext(hits, config.hydrate_budget);
      if (session) {
        hstate[session] = true;
        try { writeFileSync(hstateFile, JSON.stringify(hstate)); } catch {}
      }
    } else {
      const all = search({ project, limit: 1000, staleDays: config.stale_days });
      if (!all.length) return; // 空账本零注入——宁可不注入，不可注入垃圾
      const prefs = all.filter((h) => h.type === "preference");
      const { estimateTokens } = await import("@akm/core");
      const guide = `账本有 ${all.length} 条活跃条目；需要历史结论/文件/口径时用 \`akm search <关键词>\`（相关条目会在你第一条消息后自动注入）。\n`;
      // 导览行计入同一预算，不绕核算
      context = buildHydrationContext(prefs, config.hydrate_budget - estimateTokens(guide));
      context += `${context ? "" : "[akm] "}${guide}`;
    }

    if (!context) return;
    console.log(JSON.stringify({
      hookSpecificOutput: { hookEventName: eventName, additionalContext: context },
    }));
  } catch {
    // 静默
  }
}

// verified 是买不回的资产：人工核实过的条目在此背书，检索/水合排序上浮且衰减有下限
async function cmdVerify(flags: string[]) {
  const config = requireConfig();
  const id = flags.find((f) => !f.startsWith("--"));
  if (!id) return console.log("用法: akm verify <id> [--by <名字>]");
  const entry = readManifests(config.ledger).get(id);
  if (!entry) return console.log(`条目不存在: ${id}`);
  const by = arg(flags, "--by") ?? process.env.USER ?? "me";
  if (!entry.verified_by.includes(by)) entry.verified_by.push(by);
  const updated = { ...entry, status: entry.status === "draft" ? ("final" as const) : entry.status };
  appendManifests(config.ledger, [updated]);
  rebuildIndex(config.ledger);
  console.log(`已背书 [${id}] ${entry.coords.name}（verified_by: ${updated.verified_by.join(", ")}）`);
}

async function cmdStatus() {
  const config = requireConfig();
  const entries = [...readManifests(config.ledger).values()];
  const paths = ledgerPaths(config.ledger);
  const sessions = existsSync(paths.journalDir) ? readdirSync(paths.journalDir).length : 0;
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const e of entries) {
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    byType[e.type] = (byType[e.type] ?? 0) + 1;
  }
  const activeCount = entries.filter((e) => e.status !== "superseded" && e.status !== "quarantined").length;
  const staleHits = search({ limit: 1000, staleDays: config.stale_days }).filter((h) => h.stale);
  console.log(`# akm 账本健康报表`);
  console.log(`账本：${config.ledger}`);
  console.log(`条目：${entries.length} 条（${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join("，") || "空"}）`);
  console.log(`状态：${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join("，") || "—"}`);
  console.log(`会话 journal：${sessions} 份`);
  if (staleHits.length) {
    console.log(`\n⚠ ${staleHits.length} 条超过 ${config.stale_days} 天未被检索（已降权）：`);
    for (const h of staleHits.slice(0, 5)) console.log(`  - [${h.id}] ${h.name} ${h.summary.slice(0, 40)}`);
  }
  if (activeCount > 50) {
    console.log(`\n💡 活跃条目已达 ${activeCount} 条，可跑 \`akm compact\` 合并同主题条目（先 --dry 看方案）。`);
  }
  try {
    const errInfo = JSON.parse(readFileSync(join(CACHE_DIR, "last-distill-error.json"), "utf8"));
    if (Date.now() - Date.parse(errInfo.at) < 24 * 3600_000) {
      console.log(`\n⚠ 最近一次蒸馏失败（${errInfo.at.slice(0, 16)}，会话 ${String(errInfo.session).slice(0, 8)}）：${errInfo.error}`);
    }
  } catch {}
  try {
    const c = JSON.parse(readFileSync(join(CACHE_DIR, "last-conflicts.json"), "utf8"));
    if (c.count > 0) console.log(`\n⚠ 上次扫描发现 ${c.count} 对疑似矛盾（${String(c.at).slice(0, 16)}），跑 \`akm conflicts\` 看详情。`);
  } catch {}
  if (!entries.length) console.log(`\n账本为空。跑几个会写文件的会话，Stop hook 会自动蒸馏入账。`);
}

async function cmdUninstall() {
  const { uninstallClaudeHooks } = await import("@akm/core");
  uninstallClaudeHooks(CLAUDE_SETTINGS);
  console.log(`hooks 已摘除（${CLAUDE_SETTINGS}）。账本文件原样保留，重新启用跑 \`akm init\`。`);
}

async function cmdVersion() {
  console.log("akm 0.1.0");
}

async function cmdHelp() {
  console.log(`akm — Agent 产出物管理层
用法: akm <command>
  init [--ledger <path>] [--yes]   初始化账本并注册 Claude Code hooks
  init --project [name]            在当前目录写入 .akm 项目标记
  search <关键词…> [--all]         检索条目（相关性×新鲜度×可信度）
  get <id>                         看条目全文与溯源（记一次访问）
  verify <id> [--by <名字>]        人工背书条目（verified 排序上浮、衰减有下限）
  status                           账本健康报表
  compact [--dry]                  压实账本：合并同主题条目（保守，拿不准不动）
  conflicts                        扫出事实矛盾的条目对（只报告，你来定夺）
  export <会话id|路径> [--out f]   会话记录导出为可读 markdown
  rebuild                          全量重建索引（索引永远是缓存）
  migrate                          旧扁平正文迁移到坐标目录
  uninstall                        摘除 hooks（账本文件原样保留）
  capture / distill / hydrate      (hooks) 由宿主调用
  version                          版本`);
}

// ---- router ----
const [cmd, ...rest] = process.argv.slice(2);
const HOOK_CMDS = ["capture", "distill", "hydrate"];
const commands: Record<string, (flags: string[]) => Promise<void>> = {
  init: cmdInit,
  capture: cmdCapture,
  distill: cmdDistill,
  search: cmdSearch,
  get: cmdGet,
  verify: cmdVerify,
  compact: cmdCompact,
  conflicts: cmdConflicts,
  export: cmdExport,
  rebuild: cmdRebuild,
  migrate: cmdMigrate,
  hydrate: cmdHydrate,
  status: cmdStatus,
  uninstall: cmdUninstall,
  version: cmdVersion,
  help: cmdHelp,
};
(commands[cmd ?? "help"] ?? cmdHelp)(rest).catch((err) => {
  if (!HOOK_CMDS.includes(cmd ?? "")) {
    console.error(String(err));
    process.exit(1);
  }
  process.exit(0); // hook 静默
});

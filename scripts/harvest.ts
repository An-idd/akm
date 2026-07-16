#!/usr/bin/env bun
// 真实会话 → golden 夹具素材：从 ~/.claude 会话 jsonl 提取 Write/Edit 调用合成 journal。
// 用法: bun scripts/harvest.ts <transcript.jsonl> <outdir>
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const [transcript, outdir] = process.argv.slice(2);
if (!transcript || !outdir) {
  console.error("用法: bun scripts/harvest.ts <transcript.jsonl> <outdir>");
  process.exit(1);
}

const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const lines: string[] = [];
let session = "unknown";
for (const raw of readFileSync(transcript, "utf8").split("\n")) {
  if (!raw.trim()) continue;
  let l: any;
  try { l = JSON.parse(raw); } catch { continue; }
  session = l.sessionId ?? session;
  const content = l.message?.content;
  if (l.type !== "assistant" || !Array.isArray(content)) continue;
  for (const block of content) {
    if (block?.type !== "tool_use" || !WRITE_TOOLS.has(block.name)) continue;
    const path = block.input?.file_path ?? block.input?.notebook_path;
    if (!path) continue;
    lines.push(JSON.stringify({
      ts: l.timestamp ?? new Date(0).toISOString(),
      session,
      host: "claude-code",
      cwd: l.cwd ?? "/",
      tool: block.name,
      path,
    }));
  }
}

mkdirSync(outdir, { recursive: true });
writeFileSync(join(outdir, "journal.jsonl"), lines.join("\n") + (lines.length ? "\n" : ""));
copyFileSync(transcript, join(outdir, "transcript.jsonl"));
console.log(`session=${session} 写入 ${lines.length} 条 journal → ${outdir}`);

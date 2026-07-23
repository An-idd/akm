// golden 夹具框架：journal 进、entries 出，mock LLM 确定性回放。
// 夹具目录结构：
//   fixtures/<name>/journal.jsonl        L0 记录（可为空文件/缺失）
//   fixtures/<name>/transcript.txt       会话摘录（可缺失）
//   fixtures/<name>/mock.json            mock LLM 的 distill 回放 + judge 裁决（可缺失=空产出）
//   fixtures/<name>/expected.json        期望的 Entry[]（volatile 字段已归一化）
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  distillSession,
  DistillResult,
  Entry,
  JournalLine,
  MockProvider,
  type JudgeVerdict,
} from "@stillyou/core";

const FIXED_NOW = "2026-01-01T00:00:00.000Z";

export async function runGolden(dir: string, existing: Entry[] = []) {
  const journal = readLines(join(dir, "journal.jsonl")).map((l) => JournalLine.parse(JSON.parse(l)));
  const transcript = readIf(join(dir, "transcript.txt")) ?? "";
  const mock = JSON.parse(readIf(join(dir, "mock.json")) ?? "{}") as {
    distill?: unknown;
    judge?: JudgeVerdict;
  };
  const provider = new MockProvider(
    DistillResult.parse(mock.distill ?? { items: [] }),
    mock.judge ?? "unsure",
  );
  const { entries } = await distillSession({
    session: "golden-session",
    host: "claude-code",
    now: FIXED_NOW,
    journal,
    transcriptSummary: transcript,
    existing: new Map(existing.map((e) => [e.id, e])),
    provider,
  });
  return entries;
}

export function readExpected(dir: string): unknown {
  return JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
}

function readIf(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}
function readLines(path: string): string[] {
  return (readIf(path) ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
}

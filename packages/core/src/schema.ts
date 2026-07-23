import { z } from "zod";

// L0 journal line — capture 写入，零 LLM。字段全部确定性可得。
export const JournalLine = z.object({
  ts: z.string(), // ISO
  session: z.string(),
  host: z.string().default("claude-code"),
  cwd: z.string(),
  tool: z.string(),
  path: z.string(),
  hash: z.string().optional(), // sha256:<hex>，文件不存在/读失败则缺省
});
export type JournalLine = z.infer<typeof JournalLine>;

export const Coords = z.object({
  namespace: z.string().default("self"), // 导入/团队预留，P1 只写 "self"
  name: z.string(),
  version: z.number().int().positive().default(1),
});
export type Coords = z.infer<typeof Coords>;

export const Provenance = z.object({
  host: z.string(),
  session: z.string(),
  task_digest: z.string().optional(),
  inputs: z.array(z.string()).default([]),
  model: z.string().optional(),
});

export const EntryType = z.enum(["file", "conclusion", "decision", "preference", "skill-ref"]);
export const EntryStatus = z.enum(["draft", "final", "superseded", "stale", "quarantined"]);

export const Entry = z.object({
  id: z.string(), // 内容哈希，内容寻址
  coords: Coords,
  type: EntryType,
  status: EntryStatus,
  superseded_by: z.string().optional(), // status=superseded 时指向新条目 id
  summary: z.string(), // 蒸馏产出，给机器的检索键
  provenance: Provenance,
  verified_by: z.array(z.string()).default([]),
  scope: z.enum(["session", "project", "user"]).default("user"),
  project: z.string().optional(), // scope=project 时的项目标识
  created: z.string(), // ISO
  // file 型条目：产出物永不搬家，只记路径+哈希
  path: z.string().optional(),
  content_hash: z.string().optional(),
  // 正文相对路径（坐标化目录 entries/<ns>/<name>/v<N>-<id8>.md）；缺省回退旧位 entries/<id>.md
  body: z.string().optional(),
});
export type Entry = z.infer<typeof Entry>;

export const Config = z.object({
  ledger: z.string(), // 账本绝对路径
  hydrate_budget: z.number().int().positive().default(500), // token 预算
  stale_days: z.number().int().positive().default(30),
  archive_transcripts: z.boolean().default(true), // 蒸馏依据归档（明文对话摘录！放网盘前想清楚）
  distill_mode: z.enum(["session", "daily"]).default("session"), // daily = launchd 定时批处理，会话结束不实时蒸
});
export type Config = z.infer<typeof Config>;

// <project>/.akm 标记文件：项目身份+局部配置，不存数据
export const ProjectMarker = z.object({
  project: z.string(),
});
export type ProjectMarker = z.infer<typeof ProjectMarker>;

import { z } from "zod";
import { EntryType } from "./schema";

// 蒸馏产出的原始条目（id/coords/provenance 由管线补齐，LLM 只管语义）
export const DistilledItem = z.object({
  type: EntryType,
  name: z.string(), // 坐标 name，kebab-case
  summary: z.string(),
  status: z.enum(["draft", "final"]).default("final"),
  path: z.string().optional(), // file 型必填
  body: z.string().optional(), // conclusion/decision 型的正文 md
});
export type DistilledItem = z.infer<typeof DistilledItem>;

export const DistillResult = z.object({
  items: z.array(DistilledItem).default([]),
});
export type DistillResult = z.infer<typeof DistillResult>;

// LLM 输出偶发偏离 schema：逐条挑合法的，坏一条不废全批（宁可漏，不可全丢）
export function parseDistillLenient(raw: unknown): DistillResult {
  const items = (raw as any)?.items;
  if (!Array.isArray(items)) throw new Error("distill 输出缺 items 数组"); // 结构整个不对，抛错走重试
  return { items: items.flatMap((it) => {
    const r = DistilledItem.safeParse(it);
    return r.success ? [r.data] : [];
  }) };
}

// 取代判定：拿不准留空（unsure）——错误溯源比没有溯源更害人
export type JudgeVerdict = "supersedes" | "unrelated" | "unsure";

// compact：同主题条目簇 → 一条合并产物
export const CompactCluster = z.object({
  ids: z.array(z.string()).min(2),
  name: z.string(),
  summary: z.string(),
  body: z.string(),
});
export const CompactResult = z.object({ clusters: z.array(CompactCluster).default([]) });
export type CompactResult = z.infer<typeof CompactResult>;

export function parseCompactLenient(raw: unknown): CompactResult {
  const clusters = (raw as any)?.clusters;
  if (!Array.isArray(clusters)) throw new Error("compact 输出缺 clusters 数组");
  return { clusters: clusters.flatMap((c) => {
    const r = CompactCluster.safeParse(c);
    return r.success ? [r.data] : [];
  }) };
}

// conflicts：找事实上互相打架的条目对（只报告，不改状态）
export const ConflictPair = z.object({
  a: z.string(),
  b: z.string(),
  why: z.string(),
});
export const ConflictResult = z.object({ pairs: z.array(ConflictPair).default([]) });
export type ConflictResult = z.infer<typeof ConflictResult>;

export function parseConflictsLenient(raw: unknown): ConflictResult {
  const pairs = (raw as any)?.pairs;
  if (!Array.isArray(pairs)) throw new Error("conflicts 输出缺 pairs 数组");
  return { pairs: pairs.flatMap((p) => {
    const r = ConflictPair.safeParse(p);
    return r.success ? [r.data] : [];
  }) };
}

export interface Provider {
  distill(prompt: string): Promise<DistillResult>;
  judge(prompt: string): Promise<JudgeVerdict>;
  compact(prompt: string): Promise<CompactResult>;
  conflicts(prompt: string): Promise<ConflictResult>;
}

// golden 夹具用：确定性回放
export class MockProvider implements Provider {
  constructor(
    private distillResponse: DistillResult = { items: [] },
    private judgeResponse: JudgeVerdict = "unsure",
    private compactResponse: CompactResult = { clusters: [] },
    private conflictsResponse: ConflictResult = { pairs: [] },
  ) {}
  async distill(): Promise<DistillResult> {
    return DistillResult.parse(this.distillResponse);
  }
  async judge(): Promise<JudgeVerdict> {
    return this.judgeResponse;
  }
  async compact(): Promise<CompactResult> {
    return CompactResult.parse(this.compactResponse);
  }
  async conflicts(): Promise<ConflictResult> {
    return ConflictResult.parse(this.conflictsResponse);
  }
}

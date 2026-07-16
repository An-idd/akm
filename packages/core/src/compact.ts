import { Entry } from "./schema";
import { Provider } from "./provider";
import { entryId } from "./distill";

// 账本压实：同主题活跃条目簇 → 一条合并产物，来源整簇转 superseded（不删，真相层 append-only）。
// 保守原则：拿不准不合并；合并产物 verified 归零（人没验证过它）；来源 id 全记进 provenance.inputs。
export interface CompactContext {
  now: string;
  entries: Map<string, Entry>; // 全账本
  bodyOf: (id: string) => string | undefined;
  provider: Provider;
  host?: string;
}

export interface CompactOutput {
  fresh: Entry[]; // 合并产物
  retired: Entry[]; // 被合并的来源（已标 superseded）
  bodies: Record<string, string>;
}

export async function compactLedger(ctx: CompactContext): Promise<CompactOutput> {
  // preference 不参与合并（并入 conclusion 会静默剥夺"永不衰减"特权）；
  // verified 条目不参与（合并产物验证位归零，等于没收人工背书）
  const active = [...ctx.entries.values()].filter(
    (e) =>
      e.status !== "superseded" && e.status !== "quarantined" &&
      e.type !== "preference" && e.verified_by.length === 0,
  );
  if (active.length < 2) return { fresh: [], retired: [], bodies: {} }; // 没什么可压的

  const result = await ctx.provider.compact(buildCompactPrompt(active, ctx.bodyOf));
  const activeIds = new Map(active.map((e) => [e.id, e]));
  const used = new Set<string>();
  const fresh: Entry[] = [];
  const retired: Entry[] = [];
  const bodies: Record<string, string> = {};

  for (const cluster of result.clusters) {
    const ids = [...new Set(cluster.ids)];
    // 来源必须全部真实、活跃、未被别的簇用过——否则整簇丢弃（拿不准不合并）
    if (ids.length < 2 || !ids.every((id) => activeIds.has(id) && !used.has(id))) continue;
    const sources = ids.map((id) => activeIds.get(id)!);
    const projects = new Set(sources.map((e) => e.project ?? ""));
    const sameName = [...ctx.entries.values()].filter((e) => e.coords.name === cluster.name);
    const base = {
      coords: { namespace: "self", name: cluster.name },
      type: "conclusion" as const,
      summary: cluster.summary,
    };
    const merged = Entry.parse({
      ...base,
      coords: {
        ...base.coords,
        version: sameName.length ? Math.max(...sameName.map((e) => e.coords.version)) + 1 : 1,
      },
      id: entryId(base),
      status: "final",
      provenance: {
        host: ctx.host ?? "akm",
        session: `compact-${ctx.now.slice(0, 10)}`,
        inputs: ids,
      },
      verified_by: [],
      scope: projects.size === 1 && [...projects][0] ? "project" : "user",
      project: projects.size === 1 && [...projects][0] ? [...projects][0] : undefined,
      created: ctx.now,
    });
    ids.forEach((id) => used.add(id));
    fresh.push(merged);
    bodies[merged.id] = cluster.body;
    retired.push(...sources.map((e) => ({ ...e, status: "superseded" as const, superseded_by: merged.id })));
  }
  return { fresh, retired, bodies };
}

export function buildCompactPrompt(active: Entry[], bodyOf: (id: string) => string | undefined): string {
  // ponytail: 全量塞 prompt，条目过 300 时先只送 summary 分批——真到那天再做
  const list = active
    .map((e) => {
      const body = bodyOf(e.id);
      return [
        `- id:${e.id} name:${e.coords.name} type:${e.type} created:${e.created.slice(0, 10)}`,
        `  summary: ${e.summary}`,
        body ? `  body: ${body.slice(0, 300).replaceAll("\n", " ")}` : null,
      ].filter(Boolean).join("\n");
    })
    .join("\n");
  return [
    `你是知识账本的压实器。下面是全部活跃条目，找出说同一主题、合并后更好检索的条目簇，各合并为一条。`,
    ``,
    `## 条目`,
    list,
    ``,
    `## 规则`,
    `- 只合并明显同主题且合并后信息不丢的；不同决策各有独立价值时不要合并`,
    `- 每簇至少 2 条；一个条目最多进一个簇`,
    `- 合并产物：name 用 kebab-case、summary ≤50 字；body 提取各来源的关键结论与理由，保留分歧和时间线（后来的结论覆盖早先的要写明）`,
    `- 拿不准就不合并。没有可合并的输出空数组`,
    ``,
    `只输出 JSON：{"clusters":[{"ids":["<id>","<id>"],"name":"...","summary":"...","body":"..."}]}`,
  ].join("\n");
}

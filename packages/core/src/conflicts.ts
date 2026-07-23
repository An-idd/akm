import { Entry } from "./schema";
import { Provider } from "./provider";

// 矛盾检测：找出账本里事实上互相打架的条目对——只报告，绝不改状态。
// stillyou 首页承诺的是 consistency（两份报告打架你不知信哪个），但目前只有 supersede，
// 而 supersede 只管"同名新版覆盖旧版"；两条不同 name 的结论在事实上冲突，
// 是 supersede 看不见的盲区，这里补上。
// 铁律照 compact：拿不准不报，报了也绝不自动改 status——人来定夺（verify 一方 / 手动 supersede / 无视）。
export interface ConflictContext {
  entries: Map<string, Entry>; // 全账本
  bodyOf: (id: string) => string | undefined;
  provider: Provider;
}

export interface ConflictReport {
  a: Entry;
  b: Entry;
  why: string;
}

export async function findConflicts(ctx: ConflictContext): Promise<ConflictReport[]> {
  // 只看活跃的事实性条目：preference 不是事实断言、file 只是路径记录，都不参与。
  // 关键区别于 compact：verified 条目要包含进来——人工背书过的结论和新结论不一致，
  // 恰恰是最该被看见的信号（该信旧的那条）。
  const active = [...ctx.entries.values()].filter(
    (e) =>
      e.status !== "superseded" && e.status !== "quarantined" &&
      (e.type === "conclusion" || e.type === "decision"),
  );
  if (active.length < 2) return [];

  const result = await ctx.provider.conflicts(buildConflictsPrompt(active, ctx.bodyOf));
  const byId = new Map(active.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const reports: ConflictReport[] = [];
  for (const p of result.pairs) {
    if (p.a === p.b) continue;
    const a = byId.get(p.a), b = byId.get(p.b);
    if (!a || !b) continue; // 幻觉出来的 id 直接丢——拿不准不报
    const key = [p.a, p.b].sort().join("|");
    if (seen.has(key)) continue; // 同一对只报一次
    seen.add(key);
    reports.push({ a, b, why: p.why });
  }
  return reports;
}

export function buildConflictsPrompt(active: Entry[], bodyOf: (id: string) => string | undefined): string {
  // ponytail: 全量塞 prompt，与 compact 同一天到 300 条再分批
  const list = active
    .map((e) => {
      const body = bodyOf(e.id);
      return [
        `- id:${e.id} name:${e.coords.name} type:${e.type} created:${e.created.slice(0, 10)}${e.verified_by.length ? " [已人工验证]" : ""}`,
        `  summary: ${e.summary}`,
        body ? `  body: ${body.slice(0, 300).replaceAll("\n", " ")}` : null,
      ].filter(Boolean).join("\n");
    })
    .join("\n");
  return [
    `你是知识账本的矛盾检查器。下面是全部活跃结论/决策条目，找出事实上互相对立的条目对。`,
    ``,
    `## 条目`,
    list,
    ``,
    `## 规则`,
    `- 只报"事实断言直接对立"的对：同一件事，一条说 A、另一条说非 A（数字/结论/取舍相反）`,
    `- 同一主题的正常迭代、时间线更新、侧重点不同，都不算矛盾——那是正常演进，别报`,
    `- 拿不准是不是真冲突就不报（宁可漏，不可误报）。没有就输出空数组`,
    `- why 用一句中文说清两条在哪一点上对立`,
    ``,
    `只输出 JSON：{"pairs":[{"a":"<id>","b":"<id>","why":"..."}]}`,
  ].join("\n");
}

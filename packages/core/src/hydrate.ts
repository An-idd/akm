import { SearchHit } from "./search";

// token 估算：CJK 按 1 字 1 token，其余按 4 字符 1 token——中文为主的账本不能低估
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[一-鿿　-〿＀-￯]/g) ?? []).length;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

// top-N 摘要 → SessionStart 注入文本。硬性预算，装不下就截断；空账本返回空串（零注入）。
export function buildHydrationContext(hits: SearchHit[], budgetTokens: number): string {
  if (!hits.length) return "";
  const header =
    "[akm] 你的历史产出物账本里有以下相关条目（`akm search <关键词>` 查更多，`akm get <id>` 看全文与溯源）：\n";
  let out = header;
  let used = estimateTokens(header);
  let added = 0;
  for (const h of hits) {
    const line = `- [${h.id}] ${h.name}@v${h.version ?? 1} (${h.type}/${h.status}${h.stale ? "/stale" : ""}, ${h.created.slice(0, 10)}${h.verified ? ", verified" : ""}) ${h.summary}\n`;
    const cost = estimateTokens(line);
    if (used + cost > budgetTokens) break;
    out += line;
    used += cost;
    added++;
  }
  return added ? out : "";
}

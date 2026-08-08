import { expect, test } from "bun:test";
import { scoreEntry } from "@stillyou/core";
import { estimateTokens } from "@stillyou/core";

const NOW = new Date("2026-07-16T00:00:00.000Z");
const YEAR_AGO = "2025-07-16T00:00:00.000Z";
const YESTERDAY = "2026-07-15T00:00:00.000Z";

test("verified 资产不被新鲜度清零（衰减有下限）", () => {
  const verifiedOld = scoreEntry(
    { type: "conclusion", status: "final", created: YEAR_AGO, verified: 1 },
    Date.parse(YEAR_AGO), NOW, 30, 1,
  );
  const unverifiedOld = scoreEntry(
    { type: "conclusion", status: "final", created: YEAR_AGO, verified: 0 },
    Date.parse(YEAR_AGO), NOW, 30, 1,
  );
  expect(verifiedOld.score).toBeGreaterThan(unverifiedOld.score * 50);
});

test("preference 豁免衰减与 stale：一年前和昨天分数相同", () => {
  const old = scoreEntry(
    { type: "preference", status: "final", created: YEAR_AGO, verified: 0 },
    Date.parse(YEAR_AGO), NOW, 30, 1,
  );
  const fresh = scoreEntry(
    { type: "preference", status: "final", created: YESTERDAY, verified: 0 },
    Date.parse(YESTERDAY), NOW, 30, 1,
  );
  expect(old.score).toBe(fresh.score);
  expect(old.stale).toBe(false);
});

test("普通条目仍随时间衰减、久未检索标 stale", () => {
  const r = scoreEntry(
    { type: "file", status: "final", created: YEAR_AGO, verified: 0 },
    Date.parse(YEAR_AGO), NOW, 30, 1,
  );
  expect(r.stale).toBe(true);
  expect(r.score).toBeLessThan(0.01);
});

test("用进废退闭环：被调阅过的条目上浮，且强化有天花板", () => {
  const base = { type: "conclusion", status: "final", created: YESTERDAY, verified: 0 };
  const s = (n: number) => scoreEntry(base, Date.parse(YESTERDAY), NOW, 30, 1, n).score;
  expect(s(0)).toBeLessThan(s(1));            // 用过的 > 没用过的
  expect(s(1)).toBeLessThan(s(10));           // 单调递增
  // log 而非线性：调 100 次不能把没调过的压过一个数量级——否则热条目永久霸榜
  expect(s(100)).toBeLessThan(s(0) * 3);
});

test("从未调阅的条目不被惩罚（缺省 accessCount 与显式 0 同分）", () => {
  const r = { type: "conclusion", status: "final", created: YESTERDAY, verified: 0 };
  const implicit = scoreEntry(r, Date.parse(YESTERDAY), NOW, 30, 1).score;
  const explicit = scoreEntry(r, Date.parse(YESTERDAY), NOW, 30, 1, 0).score;
  expect(implicit).toBe(explicit);
});

test("token 估算：中文按 1 字 1 token，不再低估一倍", () => {
  const zh = "选".repeat(500);
  expect(estimateTokens(zh)).toBeGreaterThanOrEqual(500);
  expect(estimateTokens("hello world this is english")).toBeLessThan(10);
});

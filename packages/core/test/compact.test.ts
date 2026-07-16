import { expect, test } from "bun:test";
import { compactLedger, CompactResult, MockProvider, type Entry } from "@akm/core";

function entry(id: string, name: string, over: Partial<Entry> = {}): Entry {
  return {
    id,
    coords: { namespace: "self", name, version: 1 },
    type: "conclusion",
    status: "final",
    summary: `${name} 摘要`,
    provenance: { host: "x", session: "s", inputs: [] },
    verified_by: [],
    scope: "user",
    created: "2026-07-16T00:00:00.000Z",
    ...over,
  } as Entry;
}

test("preference 和 verified 条目不参与压实（特权不被静默没收）", async () => {
  const entries = new Map(
    [
      entry("aaaa000000000001", "topic-a"),
      entry("aaaa000000000002", "topic-b"),
      entry("pref000000000001", "my-rule", { type: "preference" }),
      entry("veri000000000001", "checked", { verified_by: ["me"] }),
    ].map((e) => [e.id, e]),
  );
  // mock 试图把 preference/verified 卷进合并簇——应整簇丢弃（含无效来源）
  const provider = new MockProvider(undefined, undefined, CompactResult.parse({
    clusters: [
      { ids: ["aaaa000000000001", "pref000000000001"], name: "bad-1", summary: "x", body: "x" },
      { ids: ["aaaa000000000002", "veri000000000001"], name: "bad-2", summary: "x", body: "x" },
      { ids: ["aaaa000000000001", "aaaa000000000002"], name: "good", summary: "合并", body: "正文" },
    ],
  }));
  const { fresh, retired } = await compactLedger({
    now: "2026-07-16T00:00:00.000Z",
    entries,
    bodyOf: () => undefined,
    provider,
  });
  expect(fresh.map((e) => e.coords.name)).toEqual(["good"]);
  expect(retired.every((e) => e.type !== "preference" && e.verified_by.length === 0)).toBe(true);
});

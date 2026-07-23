import { expect, test } from "bun:test";
import { findConflicts, ConflictResult, MockProvider, type Entry } from "@stillyou/core";

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

test("只报真实活跃条目对；幻觉 id、superseded、自反、重复对都丢弃", async () => {
  const entries = new Map(
    [
      entry("aaaa000000000001", "topic-a"),
      entry("aaaa000000000002", "topic-b"),
      entry("supr000000000001", "old", { status: "superseded" }),
      entry("pref000000000001", "rule", { type: "preference" }),
    ].map((e) => [e.id, e]),
  );
  const provider = new MockProvider(undefined, undefined, undefined, ConflictResult.parse({
    pairs: [
      { a: "aaaa000000000001", b: "aaaa000000000002", why: "结论相反" }, // 有效
      { a: "aaaa000000000002", b: "aaaa000000000001", why: "重复(反序)" }, // 去重丢弃
      { a: "aaaa000000000001", b: "ghost00000000000", why: "幻觉 id" }, // 丢弃
      { a: "aaaa000000000001", b: "supr000000000001", why: "含 superseded" }, // 丢弃
      { a: "aaaa000000000001", b: "pref000000000001", why: "含 preference" }, // 丢弃
      { a: "aaaa000000000002", b: "aaaa000000000002", why: "自反" }, // 丢弃
    ],
  }));
  const reports = await findConflicts({ entries, bodyOf: () => undefined, provider });
  expect(reports.length).toBe(1);
  expect(reports[0]!.why).toBe("结论相反");
  expect([reports[0]!.a.id, reports[0]!.b.id].sort()).toEqual(["aaaa000000000001", "aaaa000000000002"]);
});

test("verified 条目参与检测（该被看见的信号，与 compact 相反）", async () => {
  const entries = new Map(
    [
      entry("veri000000000001", "checked", { verified_by: ["me"] }),
      entry("aaaa000000000003", "fresh"),
    ].map((e) => [e.id, e]),
  );
  const provider = new MockProvider(undefined, undefined, undefined, ConflictResult.parse({
    pairs: [{ a: "veri000000000001", b: "aaaa000000000003", why: "验证过的和新的打架" }],
  }));
  const reports = await findConflicts({ entries, bodyOf: () => undefined, provider });
  expect(reports.length).toBe(1);
});

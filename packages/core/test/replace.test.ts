import { expect, test } from "bun:test";
import { retireReplaced, type Entry } from "@akm/core";

function entry(id: string, name: string, status: Entry["status"] = "final"): Entry {
  return {
    id,
    coords: { namespace: "self", name, version: 1 },
    type: "conclusion",
    status,
    summary: `${name} 摘要`,
    provenance: { host: "x", session: "s", inputs: [] },
    verified_by: [],
    scope: "user",
    created: "2026-07-16T00:00:00.000Z",
  };
}

test("退位条目指向同名 fresh 继任，不被他会话 superseded 条目污染", () => {
  const prior = [entry("old1", "topic-scan")];
  const produced = [
    entry("new1", "topic-scan"), // fresh 继任
    entry("dead1", "topic-scan", "superseded"), // 他会话被取代的同名条目（judge 产物）
  ];
  const retired = retireReplaced(prior, produced);
  expect(retired).toHaveLength(1);
  expect(retired[0]!.superseded_by).toBe("new1");
});

test("找不到同名继任时指针留空，绝不乱指", () => {
  const prior = [entry("old1", "topic-a")];
  const produced = [entry("new1", "topic-b")];
  const retired = retireReplaced(prior, produced);
  expect(retired[0]!.status).toBe("superseded");
  expect(retired[0]!.superseded_by).toBeUndefined();
});

test("内容没变（同 id）的条目不退位", () => {
  const same = entry("same1", "topic-a");
  expect(retireReplaced([same], [same])).toHaveLength(0);
});

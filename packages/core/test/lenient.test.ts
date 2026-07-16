import { expect, test } from "bun:test";
import { parseDistillLenient } from "@akm/core";

test("坏 item 只丢单条，不废整批", () => {
  const r = parseDistillLenient({
    items: [
      { type: "file", name: "good", summary: "ok", path: "/a" },
      { type: "banana", name: "bad-type", summary: "x" }, // 非法 type
      { type: "decision", summary: "缺 name" },
      { type: "conclusion", name: "good-2", summary: "ok2" },
    ],
  });
  expect(r.items.map((i) => i.name)).toEqual(["good", "good-2"]);
});

test("整体结构不对照常抛错（触发上层重试）", () => {
  expect(() => parseDistillLenient({ results: [] })).toThrow();
});

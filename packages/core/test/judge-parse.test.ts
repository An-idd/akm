import { expect, test } from "bun:test";
import { parseVerdict } from "@akm/core";

test("歧义滑向 unsure，绝不滑向 supersedes", () => {
  expect(parseVerdict("unsure — it might supersede but I can't tell")).toBe("unsure");
  expect(parseVerdict("It does NOT supersede the old one")).toBe("unsure");
  expect(parseVerdict("not supersedes")).toBe("unsure");
  expect(parseVerdict("hmm hard to say")).toBe("unsure");
});

test("明确裁决正常解析", () => {
  expect(parseVerdict("supersedes")).toBe("supersedes");
  expect(parseVerdict("The new entry clearly supersedes the old.")).toBe("supersedes");
  expect(parseVerdict("unrelated")).toBe("unrelated");
});

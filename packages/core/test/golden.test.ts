import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { runGolden, readExpected } from "./golden";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("golden: journal 进 entries 出", () => {
  for (const name of readdirSync(FIXTURES)) {
    test(name, async () => {
      const dir = join(FIXTURES, name);
      const entries = await runGolden(dir);
      expect(JSON.parse(JSON.stringify(entries))).toEqual(readExpected(dir));
    });
  }
});

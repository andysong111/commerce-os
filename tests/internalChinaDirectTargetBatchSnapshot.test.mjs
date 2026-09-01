import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../src/lib/internalChinaGroupCostPriceExecution.ts", import.meta.url),
  "utf8",
);

test("price execution batch reservations use a non-null JSON snapshot", () => {
  assert.match(source, /result_snapshot:\s*\{\}/);
  assert.doesNotMatch(source, /result_snapshot:\s*null/);
});

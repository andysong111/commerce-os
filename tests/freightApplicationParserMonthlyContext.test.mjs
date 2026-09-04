import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const parserSource = await readFile(
  new URL("../src/lib/freightApplicationParser.ts", import.meta.url),
  "utf8",
);

const monthlySource = await readFile(
  new URL("../src/lib/freightMonthlyOrderContext.ts", import.meta.url),
  "utf8",
);

test("freight parser applies active monthly order context after product master enrichment", () => {
  assert.match(
    parserSource,
    /applyActiveFreightMonthlyOrderContext\(productMasterItems\)/,
  );
  assert.match(
    parserSource,
    /오픈마켓\\s\*주문번호/,
  );
});

test("monthly context prioritizes exact order number and rejects tied duplicate lines", () => {
  assert.match(monthlySource, /score \+= 1_000/);
  assert.match(monthlySource, /sorted\[0\]\.score === sorted\[1\]\.score/);
  assert.match(monthlySource, /return -1/);
});

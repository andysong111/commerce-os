import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0329/download/route.ts", import.meta.url);

test("v0.3.29 recovers a result channel from exact worker tab/window ownership", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /const VERSION = "0\.3\.29"/);
  assert.match(source, /findAssignment\(meta, \{ tab \}, true\)/);
  assert.match(source, /tabAssignedGoodsKey/);
  assert.match(source, /settledFrames = tabAssignment \? settledAny/);
  assert.match(source, /assignment = tabAssignment \|\|/);
});

test("v0.3.29 allows any-success settlement without requiring parsed goods_key in every child frame", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /frames\.every\(\(row\) => row\.settled === true\)/);
  assert.match(source, /Boolean\(tabAssignment\)/);
  assert.match(source, /성공 1건 이상이면 즉시 sent/);
});

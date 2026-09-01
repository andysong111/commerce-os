import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0327/download/route.ts", import.meta.url);

test("v0.3.27 keeps full parallel execution but retires stale legacy running queue", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /const VERSION = "0\.3\.27"/);
  assert.match(source, /commerceOsShoplingMarketSelectionQueueV0326/);
  assert.match(source, /superseded_by_v0327/);
  assert.match(source, /전체병렬 구조/);
  assert.match(source, /서버 원장이 현재 상태의 최종 기준/);
});

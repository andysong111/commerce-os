import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0321/download/route.ts", import.meta.url);

test("v0.3.21 directly reconciles result frames in background", async () => {
  const source = await readFile(packageRoute, "utf8");
  for (const needle of [
    'const VERSION = "0.3.21"',
    'directReconcileResultTab',
    'directResultFrameSnapshot',
    'chrome.scripting.executeScript',
    'shopling_result_background_direct_success_v0321',
    'shopling_result_background_direct_failure_v0321',
  ]) {
    assert.equal(source.includes(needle), true, `missing ${needle}`);
  }
});

test("v0.3.21 preserves one A18 controller and v0.3.20 state", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.equal(source.includes('commerceOsShoplingParallelWorkerMetaV0320'), true);
  assert.equal(source.includes('commerceOsShoplingMarketSelectionQueueV0320'), true);
  assert.equal(source.includes('관리자 A18 원본은 계속 1개만 필요'), true);
  assert.equal(source.includes('getV0320Package'), true);
});

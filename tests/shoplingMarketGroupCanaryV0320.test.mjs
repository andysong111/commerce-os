import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0320/download/route.ts", import.meta.url);
const statusRoute = new URL("../src/app/api/shopling-market-group-canary/selection/status/route.ts", import.meta.url);

test("v0.3.20 reconciles active wave from Commerce OS server status", async () => {
  const source = await readFile(packageRoute, "utf8");
  for (const needle of [
    'const VERSION = "0.3.20"',
    'commerce-os-shopling-selected-status-v0320',
    'shopling-market-selection-status-v0.1',
    'server_reconciled',
    'selectedWaveStates(queue)',
    '관리자 A18 원본은 계속 1개만 사용',
    'getV0319Package',
  ]) {
    assert.equal(source.includes(needle), true, `missing ${needle}`);
  }
});

test("selection status endpoint only reconciles goods keys from the selected Shopling upload job", async () => {
  const source = await readFile(statusRoute, "utf8");
  for (const needle of [
    'const BRIDGE = "shopling-market-selection-status-v0.1"',
    'product_launch_upload_jobs',
    'shopling_market_pipeline_ledger',
    'jobGoodsKeys',
    'validSet.has(key)',
    'busyCount',
    'terminalCount',
  ]) {
    assert.equal(source.includes(needle), true, `missing ${needle}`);
  }
});

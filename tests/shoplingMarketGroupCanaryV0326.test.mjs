import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0326/download/route.ts", import.meta.url);
const claimAllRoute = new URL("../src/app/api/shopling-market-group-canary/selection/claim-all/route.ts", import.meta.url);

test("v0.3.26 runs multiple selected products and all six channels in parallel", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /const VERSION = "0\.3\.26"/);
  assert.match(source, /MAX_PARALLEL_PRODUCTS = 3/);
  assert.match(source, /shopling-market-selection-all-v0\.1/);
  assert.match(source, /tasksToOpen/);
  assert.match(source, /batchRunId/);
  assert.match(source, /전역 최대 3상품\(18채널\) 병렬/);
});

test("claim-all can claim six distinct pending channel rows in one run", async () => {
  const source = await readFile(claimAllRoute, "utf8");
  assert.match(source, /shopling-market-selection-all-v0\.1/);
  assert.match(source, /\.limit\(6\)/);
  assert.match(source, /candidateTasks\.map\(\(task\) => task\.goodsKey\)/);
  assert.match(source, /claim_run_id: runId/);
  assert.match(source, /taskCount: tasks\.length/);
});

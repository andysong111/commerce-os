import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bridge = readFileSync("src/lib/shoplingPriceAdjustmentBatchCanaryRunner.ts", "utf8");
const panel = readFileSync("src/components/shopling-price-adjustment/ShoplingPriceAdjustmentBatchCanaryPanel.tsx", "utf8");
const orchestrator = readFileSync("src/lib/shoplingPriceAdjustmentBulkOrchestrator.ts", "utf8");
const server = readFileSync("src/lib/shoplingPriceAdjustmentBulkServer.ts", "utf8");
const migration = readFileSync("supabase/migrations/202607290001_shopling_price_adjustment_bulk_10000.sql", "utf8");
const page = readFileSync("src/app/shopling-price-adjustment-runner/page.tsx", "utf8");
const advanceRoute = readFileSync("src/app/api/shopling-price-adjustment/bulk/jobs/[jobId]/advance/route.ts", "utf8");

test("chunk executor bridge is capped at fifty and uses explicit serial confirmation", () => {
  assert.match(bridge, /shopling-price-adjustment-batch-canary\.yml/);
  assert.match(bridge, /shopling-price-adjustment-batch-canary-summary/);
  assert.match(bridge, /CONFIRM_FIFTY_PRICE_ADJUSTMENT_SERIAL/);
  assert.match(bridge, /const MAX_ROWS = 50/);
  assert.match(bridge, /inputCount: input\.length/);
  assert.match(bridge, /requires_option_write/);
});

test("bulk server accepts up to ten thousand unique adjustment rows", () => {
  assert.match(server, /const MAX_ROWS = 10_000/);
  assert.match(server, /record\.rows\.length > MAX_ROWS/);
  assert.match(server, /중복 goods_key/);
  assert.match(server, /adjustmentBps/);
});

test("bulk schema isolates adjustment jobs and chunks first ten then fifty", () => {
  assert.match(migration, /shopling_price_adjustment_bulk_jobs/);
  assert.match(migration, /valid_count between 1 and 10000/);
  assert.match(migration, /ordinal <= 10 then 0/);
  assert.match(migration, /\(\(ordinal - 11\) \/ 50\)/);
  assert.match(migration, /claim_shopling_price_adjustment_bulk_job/);
  assert.match(migration, /dispatch_uncertain/);
});

test("orchestrator plans and executes one persistent chunk at a time", () => {
  assert.match(orchestrator, /dispatchShoplingPriceAdjustmentPlan/);
  assert.match(orchestrator, /fetchShoplingPriceAdjustmentPlanResult/);
  assert.match(orchestrator, /dispatchShoplingPriceAdjustmentBatchCanary/);
  assert.match(orchestrator, /fetchShoplingPriceAdjustmentBatchCanaryResult/);
  assert.match(orchestrator, /buildExecutionRowsFromPlan/);
  assert.match(orchestrator, /claim_shopling_price_adjustment_bulk_job/);
  assert.match(orchestrator, /first failure|실패/);
});

test("bulk panel creates, resumes and pauses a persistent ten-thousand item job", () => {
  assert.match(panel, /const MAX_BULK_SIZE = 10_000/);
  assert.match(panel, /현재 입력으로 Bulk 작업 시작/);
  assert.match(panel, /자동 진행 재개/);
  assert.match(panel, /현재 단계 후 일시중지/);
  assert.match(panel, /최대 10,000개 Bulk 실제 가격 변경/);
  assert.match(panel, /shoplingPriceAdjustment\.currentBulkJobId/);
  assert.match(panel, /\/api\/shopling-price-adjustment\/bulk\/jobs/);
});

test("page and advance route connect the 10k bulk runner", () => {
  assert.match(page, /ShoplingPriceAdjustmentBatchCanaryPanel/);
  assert.match(advanceRoute, /advanceShoplingPriceAdjustmentBulkJob/);
});

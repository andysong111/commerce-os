import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page, api, cron, vercel] = await Promise.all([
  readFile("src/lib/stage8CanonicalDemandParity.ts", "utf8"),
  readFile("src/app/stage8-demand-parity/page.tsx", "utf8"),
  readFile("src/app/api/stage8/canonical-demand-parity/route.ts", "utf8"),
  readFile("src/app/api/cron/stage8-canonical-demand-parity/route.ts", "utf8"),
  readFile("vercel.json", "utf8"),
]);

test("parity pins Product Master canonical sales and direct Shopling to one analysisAsOf", () => {
  assert.match(engine, /audit\.analysisAsOf !== request\.analysisAsOf/);
  assert.match(engine, /audit\.snapshot\.contentFingerprint !== request\.canonicalContentFingerprint/);
  assert.match(engine, /planning\.contentFingerprint !== request\.planningContentFingerprint/);
  assert.match(engine, /aggregateShoplingOrderChunk\([\s\S]*request\.analysisAsOf/);
  assert.match(engine, /combineShoplingLiveChunks\([\s\S]*request\.analysisAsOf/);
});

test("parity compares exact 12-bucket units and revenue per managed B-code", () => {
  assert.match(engine, /const BUCKET_COUNT = 12/);
  assert.match(engine, /MANAGED_BARCODE = \/\^B\[A-Z\]\{2\}/);
  assert.match(engine, /arraysEqual\(canonicalRow\.monthlyUnits, directRow\.units\)/);
  assert.match(engine, /arraysEqual\(canonicalRow\.monthlyRevenue, directRow\.revenue\)/);
  assert.match(engine, /unitMismatchCount/);
  assert.match(engine, /revenueMismatchCount/);
  assert.match(engine, /missingDirectBarcodes/);
  assert.match(engine, /directOnlyManagedBarcodes/);
});

test("direct portfolio revenue remains informational and does not decide SKU parity", () => {
  assert.match(engine, /directPortfolioRecent30Revenue/);
  assert.doesNotMatch(engine, /directPortfolioRecent30Revenue[\s\S]*blockerCount\s*=/);
  assert.match(page, /포트폴리오 예산의 최근30일 총매출/);
  assert.match(page, /동일성 게이트는 현재 관리 SKU의 12×30일 수량·매출 배열에만 적용/);
});

test("parity worker is read-only for business data and only records operation evidence", () => {
  assert.match(engine, /ShoplingReadClient/);
  assert.match(engine, /commerce_operation_runs/);
  assert.doesNotMatch(engine, /sku_sales_events[^\n]*POST|inventory_movements|sku_receipt_costs|price change|1688/i);
  assert.doesNotMatch(cron, /applyProductMasterShoplingSalesEvents|calculateProductDecisionPlan/);
  assert.match(page, /발주·가격·재고 쓰기는 없습니다/);
});

test("cron and same-origin API can resume the durable read-only comparison", () => {
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /runCanonicalDemandParityStep/);
  assert.match(api, /isSameOriginOpsRequest/);
  assert.match(api, /run-next/);
  assert.match(api, /createCanonicalDemandParityRequest/);
  assert.match(vercel, /\/api\/cron\/stage8-canonical-demand-parity/);
  assert.match(vercel, /"schedule": "\* \* \* \* \*"/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, cron, page, vercel] = await Promise.all([
  readFile("src/lib/canonicalSalesEventIncrementalShadow.ts", "utf8"),
  readFile("src/app/api/cron/stage8-canonical-sales-event-incremental-shadow/route.ts", "utf8"),
  readFile("src/app/stage8-canonical-sales-event-incremental-shadow/page.tsx", "utf8"),
  readFile("vercel.json", "utf8"),
]);

test("exact-event incremental shadow only verifies persisted events and never writes them", () => {
  assert.match(engine, /\/api\/integrations\/sales-events\/verify/);
  assert.match(engine, /writesEnabled: false/);
  assert.match(engine, /verifyProductMasterEvents/);
  assert.doesNotMatch(engine, /\/api\/integrations\/sales-events["'`]/);
  assert.doesNotMatch(engine, /applyProductMasterShoplingSalesEvents/);
  assert.doesNotMatch(engine, /upsertSalesEvents/);
  assert.doesNotMatch(engine, /barcode-ledgers/);
  assert.match(page, /SALES EVENT WRITE BLOCKED/);
});

test("source overlap uses the existing previous-three-months-plus-current policy and seven day partitions", () => {
  assert.match(engine, /buildShoplingIncrementalWindow\(now, 3\)/);
  assert.match(engine, /CANONICAL_EVENT_INCREMENTAL_SHADOW_SOURCE_DAYS = 7/);
  assert.match(engine, /splitShoplingDateRange/);
  assert.match(engine, /previous-3-full-months-plus-current-month/);
  assert.match(page, /최근 3개 완료월\+현재월/);
});

test("mapping and baseline fingerprints are pinned before source reads and verification", () => {
  assert.match(engine, /planningMappingFingerprint/);
  assert.match(engine, /baselineReconciliationFingerprint/);
  assert.match(engine, /currentMappingFingerprint !== request\.planningMappingFingerprint/);
  assert.match(engine, /VERIFY_FINGERPRINT_DRIFT/);
  assert.match(engine, /candidateFingerprint/);
});

test("unmapped or identity conflicts fail closed before Product Master verification", () => {
  assert.match(engine, /combined\.unmappedRows > 0/);
  assert.match(engine, /combined\.conflictExternalIds\.length > 0/);
  assert.match(engine, /SOURCE_BLOCKERS/);
  assert.match(engine, /CANONICAL_EVENT_VERIFY_ACCOUNTING_INVALID/);
  assert.match(engine, /CANONICAL_EVENT_VERIFY_FOREIGN_MISMATCH_ID/);
});

test("shadow is durable, periodic, and keeps full refresh as an explicit residual requirement", () => {
  assert.match(engine, /commerce_operation_runs/);
  assert.match(engine, /CANONICAL_EVENT_INCREMENTAL_SHADOW_INTERVAL_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(engine, /fullRefreshStillRequired: true/);
  assert.match(engine, /pendingMismatchCount/);
  assert.match(page, /전체 360일 전수검증/);
  assert.match(vercel, /stage8-canonical-sales-event-incremental-shadow/);
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /writesEnabled: false/);
});

test("the shadow reuses the proven exact-event resolver rather than monthly sales aggregation", () => {
  assert.match(engine, /aggregateProductMasterShoplingSalesEventChunk/);
  assert.match(engine, /combineProductMasterShoplingSalesEventChunks/);
  assert.match(engine, /PRODUCT_MASTER_SALES_EVENT_FORMAT/);
  assert.match(engine, /PRODUCT_MASTER_SALES_EVENT_SOURCE/);
  assert.doesNotMatch(engine, /aggregateProductMasterShoplingSalesChunk/);
  assert.doesNotMatch(engine, /pushSales/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const audit = await readFile(
  "src/lib/stage8HistoricalSalesCoverageAudit.ts",
  "utf8",
);
const page = await readFile(
  "src/app/stage8-historical-sales-coverage-audit/page.tsx",
  "utf8",
);

test("historical coverage reuses stored 24-month chunk evidence instead of refetching Shopling", () => {
  assert.match(audit, /PRODUCT_MASTER_SHOPLING_SALES_CHUNK/);
  assert.match(audit, /commerce_operation_runs/);
  assert.match(audit, /loadProductMasterShoplingSalesStatus/);
  assert.doesNotMatch(audit, /ShoplingReadClient|shoplingReadConfigFromEnv/);
  assert.match(page, /Shopling을 다시 호출하거나/);
});

test("stored monthly rows are aggregated by validation B-code and compared with canonical 360 days", () => {
  assert.match(audit, /legacyOrderSurrogateValidationEvidence/);
  assert.match(audit, /loadProductMasterCanonicalSalesAudit/);
  assert.match(audit, /monthlyEvidence\(chunks, key\)/);
  assert.match(audit, /backfillPreCanonicalFullMonthQuantity/);
  assert.match(audit, /backfillCanonicalStartMonthQuantity/);
  assert.match(audit, /historicalMonthPresentBeforeCanonicalWindow/);
});

test("historical sales coverage audit remains business read-only", () => {
  assert.match(audit, /businessWritesPerformed:\s*false/);
  assert.match(audit, /inventoryWritesEnabled:\s*false/);
  assert.doesNotMatch(audit, /method:\s*["']POST/);
  assert.doesNotMatch(audit, /upsert|insert|delete/);
  assert.match(page, /실제 재고를 쓰지 않습니다/);
});

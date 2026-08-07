import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [service, page] = await Promise.all([
  readFile("src/lib/productMasterShoplingSalesUnmappedDiagnostic.ts", "utf8"),
  readFile(
    "src/app/product-master/shopling-sales-backfill/unmapped-diagnostic/page.tsx",
    "utf8",
  ),
]);

test("diagnostic reads only existing immutable backfill chunks and current planning snapshot", () => {
  assert.match(service, /PRODUCT_MASTER_SHOPLING_SALES_REQUEST/);
  assert.match(service, /PRODUCT_MASTER_SHOPLING_SALES_CHUNK/);
  assert.match(service, /commerce_operation_runs/);
  assert.match(service, /loadProductPlanningSnapshot/);
  assert.match(service, /sourceReadsPerformed: false/);
  assert.match(service, /businessWritesPerformed: false/);
  assert.doesNotMatch(service, /ShoplingReadClient|postShoplingXml|barcode-ledgers/);
  assert.doesNotMatch(service, /method:\s*"POST"|method:\s*"PUT"|method:\s*"PATCH"|method:\s*"DELETE"/);
});

test("classification separates current-SKU risks from outside-current-master candidates", () => {
  for (const category of [
    "CURRENT_MANAGED_CODE_UNRESOLVED",
    "CURRENT_OPTION_ID_UNRESOLVED",
    "CURRENT_GOODS_KEY_UNRESOLVED",
    "OUTSIDE_CURRENT_PRODUCT_MASTER",
    "NO_CURRENT_IDENTITY",
    "MISSING_IDENTIFIERS",
  ]) {
    assert.match(service, new RegExp(category));
  }
  assert.match(service, /categoryRisk/);
  assert.match(service, /"BLOCKER" as const/);
  assert.match(service, /"REVIEW" as const/);
});

test("diagnostic never exposes stored order numbers or buyer data on the page", () => {
  assert.doesNotMatch(page, /orderNo|orderLineId|buyer|buyerName|recipient|phone|address/i);
  assert.match(page, /주문번호·구매자·금액은 노출하지 않습니다/);
  assert.match(page, /Shopling 재조회 0회/);
  assert.match(page, /Product Master\/Shopling 쓰기 0회/);
});

test("sampling is bounded and reports sample coverage instead of pretending to classify all rows", () => {
  assert.match(service, /MAX_SAFE_SAMPLES = 100/);
  assert.match(service, /sampledUnmappedRows/);
  assert.match(service, /sampleCoverage/);
  assert.match(page, /샘플 커버리지/);
});

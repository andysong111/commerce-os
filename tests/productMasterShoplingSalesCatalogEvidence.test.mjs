import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [service, page] = await Promise.all([
  readFile("src/lib/productMasterShoplingSalesCatalogEvidence.ts", "utf8"),
  readFile(
    "src/app/product-master/shopling-sales-backfill/unmapped-diagnostic/catalog-evidence/page.tsx",
    "utf8",
  ),
]);

test("catalog evidence reads only immutable product diagnostic chunks and existing unmapped evidence", () => {
  assert.match(service, /PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_REQUEST/);
  assert.match(service, /PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_CHUNK/);
  assert.match(service, /loadProductMasterShoplingSalesUnmappedDiagnostic/);
  assert.match(service, /loadProductPlanningSnapshot/);
  assert.match(service, /commerce_operation_runs/);
  assert.match(service, /sourceReadsPerformed: false/);
  assert.match(service, /businessWritesPerformed: false/);
  assert.doesNotMatch(service, /ShoplingReadClient|postShoplingXml|barcode-ledgers/);
  assert.doesNotMatch(service, /method:\s*"POST"|method:\s*"PUT"|method:\s*"PATCH"|method:\s*"DELETE"/);
});

test("catalog evidence uses the same managed-code fallback as immutable catalog chunks", () => {
  assert.match(service, /const directBarcode = normalizeBarcode\(row\.barcode\)/);
  assert.match(
    service,
    /const partnerOptionCode = normalizeBarcode\(row\.partnerOptionCode\)/,
  );
  assert.match(service, /const barcode = directBarcode \|\| partnerOptionCode/);
  assert.match(service, /partnerOptionCode,/);
});

test("only exact historical option, current barcode and unique current units becomes an auto-resolve candidate", () => {
  assert.match(service, /CATALOG_EXACT_OPTION_CURRENT_BARCODE_SAFE_UNITS/);
  assert.match(service, /barcodes\.size !== 1/);
  assert.match(service, /current\.units\.size !== 1/);
  assert.match(service, /autoResolveCandidate: true/);
  assert.match(service, /CATALOG_EXACT_OPTION_LEGACY_BARCODE/);
  assert.match(service, /CATALOG_OPTION_ID_AMBIGUOUS/);
  assert.match(service, /CATALOG_GOODS_KEY_ONLY/);
  assert.match(service, /NO_CATALOG_EVIDENCE/);
});

test("historical matches expose only product identity metadata and current deterministic units", () => {
  for (const field of [
    "goodsKey",
    "optionId",
    "barcode",
    "productName",
    "optionName",
    "currentSkuId",
    "uniqueCurrentUnitsPerOrder",
  ]) {
    assert.match(service, new RegExp(field));
  }
  assert.doesNotMatch(page, /orderNo|orderLineId|buyer|recipient|phone|address/i);
});

test("operator page makes diagnostic-only boundary explicit", () => {
  assert.match(page, /NO NEW SHOPLING READS · NO BUSINESS WRITES/);
  assert.match(page, /고신뢰 후보 — 아직 진단만/);
  assert.match(page, /현재 단계에서는 판매원장을 다시 계산하거나 저장하지 않습니다/);
  assert.match(page, /자동 제외·자동 매핑을 실행하지 않습니다/);
});

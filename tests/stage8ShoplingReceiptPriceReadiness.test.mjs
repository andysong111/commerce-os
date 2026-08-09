import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page] = await Promise.all([
  readFile("src/lib/stage8ShoplingReceiptPriceReadiness.ts", "utf8"),
  readFile("src/app/stage8-shopling-receipt-price-readiness/page.tsx", "utf8"),
]);

test("Shopling live price is the current-price source of truth for repricing", () => {
  assert.match(engine, /loadShoplingCurrentPriceSnapshot/);
  assert.match(engine, /currentPrice: listing\.effectiveSalePrice/);
  assert.match(engine, /SHOPLING_LIVE_PRODUCT_LOOKUP/);
  assert.match(engine, /productMasterCurrentPrice/);
  assert.match(engine, /livePriceDiffersFromProductMaster/);
  assert.match(page, /샵플링 현재가/);
  assert.match(page, /LIVE 우선/);
});

test("confirmed receipt newer than the previous price lifecycle is the repricing trigger", () => {
  assert.match(engine, /latestReceipt/);
  assert.match(engine, /receiptTriggered/);
  assert.match(engine, /receiptAt > lifecycleAt/);
  assert.match(engine, /input\.existingLifecycle\?\.calculatedAt/);
  assert.match(engine, /affectedInputs = allInputs\.filter\(receiptTriggeredInput\)/);
  assert.match(page, /새 확정입고 후 가격변경 후보/);
});

test("live Shopling lookup is limited to receipt-affected planning products", () => {
  assert.match(engine, /if \(!affectedInputs\.length\)/);
  assert.match(engine, /return emptyReadiness/);
  assert.match(engine, /affectedBarcodes\.has\(barcodeKey\(product\.barcode\)\)/);
  assert.match(
    engine,
    /loadShoplingCurrentPriceSnapshot\(affectedPlanningProducts\)/,
  );
  assert.match(engine, /shoplingLookupMode: "RECEIPT_AFFECTED_ONLY"/);
  assert.match(engine, /shoplingLookupSkipped: true/);
  assert.match(page, /전체 카탈로그를 반복 조회하지 않습니다/);
  assert.match(page, /새 입고 SKU만 LIVE 조회/);
});

test("existing price-grade and protected receipt-cost rules calculate the target price", () => {
  assert.match(engine, /calculateProductPriceGrade/);
  assert.match(engine, /PRICE_GRADE_RULE_VERSION/);
  assert.match(engine, /loadPriceGradeReceiptAugmentedSnapshot/);
  assert.match(engine, /PRODUCT_MASTER_WITH_RECEIPT_CACHE_FALLBACK/);
  assert.match(engine, /protectionCostKrw: result\.protectionCost/);
  assert.match(engine, /marginFloorPrice: result\.marginFloorPrice/);
});

test("goods-key execution checks all active B-code owners before becoming eligible", () => {
  assert.match(engine, /activeGoodsKeyOwners/);
  assert.match(engine, /unaffectedOwnerBarcodes/);
  assert.match(engine, /unplannedOwnerBarcodes/);
  assert.match(engine, /!affectedBarcodes\.has\(barcode\)/);
  assert.match(engine, /!plannedBarcodes\.has\(barcode\)/);
  assert.match(engine, /nonzeroBps\.length > 1/);
  assert.match(engine, /automaticApplyEligible/);
  assert.match(page, /모든 활성 소유자가 이번 새 입고 대상이고 가격계획에 포함/);
  assert.match(page, /입고 비대상 B-code와 공유하거나 옵션별 조정률이 다르면 자동 적용을 금지/);
});

test("readiness stage does not modify Shopling prices", () => {
  assert.match(engine, /writesEnabled: false/);
  assert.match(page, /0 · READ ONLY/);
  assert.doesNotMatch(
    engine,
    /dispatchShoplingPriceModifyActions|prod_modify_api|method:\s*["']PUT["']/i,
  );
});

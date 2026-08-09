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
  assert.match(page, /새 확정입고 후 가격변경 후보/);
});

test("existing price-grade and protected receipt-cost rules calculate the target price", () => {
  assert.match(engine, /calculateProductPriceGrade/);
  assert.match(engine, /PRICE_GRADE_RULE_VERSION/);
  assert.match(engine, /loadPriceGradeReceiptAugmentedSnapshot/);
  assert.match(engine, /PRODUCT_MASTER_WITH_RECEIPT_CACHE_FALLBACK/);
  assert.match(engine, /protectionCostKrw: result\.protectionCost/);
  assert.match(engine, /marginFloorPrice: result\.marginFloorPrice/);
});

test("goods-key execution remains fail closed when option adjustment rates cannot be collapsed safely", () => {
  assert.match(engine, /groupByGoodsKey/);
  assert.match(engine, /nonzeroBps\.length > 1/);
  assert.match(engine, /triggered\.length === rows\.length/);
  assert.match(engine, /blockedRows\.length === 0/);
  assert.match(engine, /automaticApplyEligible/);
  assert.match(page, /같은 goods_key 안의 옵션들이 서로 다른 조정률을 요구하면 자동 적용을 금지/);
});

test("readiness stage does not modify Shopling prices", () => {
  assert.match(engine, /writesEnabled: false/);
  assert.match(page, /0 · READ ONLY/);
  assert.doesNotMatch(engine, /dispatchShoplingPriceModifyActions|prod_modify_api|method:\s*["']PUT["']/i);
});

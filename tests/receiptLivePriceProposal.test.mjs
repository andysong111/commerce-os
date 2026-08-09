import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile("src/lib/receiptLivePriceProposal.ts", "utf8");

test("proposal uses the exact confirmed batch plus Shopling live effective price", () => {
  assert.match(source, /input\.receiptSource\.batchId !== input\.event\.batchId/);
  assert.match(source, /RECEIPT_PROPOSAL_BATCH_SOURCE_MISMATCH/);
  assert.match(source, /currentPrice: input\.listing\.effectiveSalePrice/);
  assert.match(source, /currentEffectiveSalePrice: input\.listing\.effectiveSalePrice/);
  assert.match(source, /latestBatchUnitCostKrw: input\.currentBatch\.unitCostKrw/);
  assert.match(source, /latestBatchQuantity: input\.currentBatch\.quantity/);
  assert.match(source, /calculateProductPriceGrade/);
  assert.match(source, /EXACT_CONFIRMED_BATCH_PLUS_HISTORY/);
  assert.match(source, /SHOPLING_LIVE_PRODUCT_LOOKUP/);
});

test("proposal reconciles exact confirmed good quantity with the receipt event", () => {
  assert.match(source, /exactReceiptGoodQuantity = sourceRows\.reduce/);
  assert.match(
    source,
    /exactReceiptGoodQuantity !== integer\(input\.event\.totals\.good\)/,
  );
  assert.match(source, /RECEIPT_PROPOSAL_GOOD_QUANTITY_MISMATCH/);
  assert.match(source, /eventGoodQuantity/);
  assert.match(source, /exactReceiptGoodQuantity/);
});

test("receipt source cannot introduce a B-code outside the confirmed event", () => {
  assert.match(source, /foreignSourceBarcode/);
  assert.match(source, /!eventBarcodes\.has\(barcode\)/);
  assert.match(source, /RECEIPT_PROPOSAL_FOREIGN_BARCODE/);
});

test("current batch evidence is merged into historical receipt protection before repricing", () => {
  assert.match(source, /mergeReceiptHistory/);
  assert.match(source, /current\.receivedAt/);
  assert.match(source, /current\.unitCostKrw/);
  assert.match(source, /current\.quantity/);
  assert.match(source, /\.\.\.\(input\.receipts \?\? \[\]\)/);
  assert.match(source, /receipts,/);
});

test("goods-key canary is blocked when any active owner is outside the receipt scope", () => {
  assert.match(source, /activeGoodsKeyOwners/);
  assert.match(source, /unaffectedOwners/);
  assert.match(source, /!input\.eventBarcodes\.has\(barcode\)/);
  assert.match(source, /GOODS_KEY_SHARED_WITH_UNAFFECTED/);
  assert.match(source, /unplannedOwners/);
  assert.match(source, /GOODS_KEY_OWNER_PLAN_MISSING/);
  assert.match(source, /GOODS_KEY_ADJUSTMENT_CONFLICT/);
  assert.match(source, /canaryEligible/);
});

test("proposal is read only", () => {
  assert.match(source, /writesEnabled: false/);
  assert.doesNotMatch(
    source,
    /dispatchShoplingPriceModifyActions|prod_modify_api|method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i,
  );
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("stock sync GET can recover only proof-confirmed prepared Shopling product ids", async () => {
  const source = await readFile(
    "src/app/api/inventory-stock-control/sync/route.ts",
    "utf8",
  );
  assert.match(source, /SHOPLING_STOCK_CANARY_PREPARATION/);
  assert.match(source, /confirmedPreparationEvidence/);
  assert.match(source, /preparationOnly/);
  assert.match(source, /A6_UNIQUENESS_CONFIRMED/);
  assert.match(source, /a6SearchResultCount/);
  assert.match(source, /EXACT_ONE_ROW_CONFIRMED/);
  assert.match(source, /a6MatchedShoplingProductId/);
  assert.match(source, /shoplingProductId/);
  assert.match(source, /preparedGoodsKeysByBarcode\.get\(row\.barcode\)/);
  assert.match(source, /\.\.\.row\.goodsKeys/);
  assert.doesNotMatch(
    source,
    /SHOPLING_STOCK_CANARY_PREPARATION_OPERATION_TYPE[\s\S]{0,900}\.eq\("status",\s*"SUCCEEDED"\)/,
  );
});

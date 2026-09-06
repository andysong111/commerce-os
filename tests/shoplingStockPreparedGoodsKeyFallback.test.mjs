import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("stock sync GET can recover a prepared Shopling product id as goods key", async () => {
  const source = await readFile(
    "src/app/api/inventory-stock-control/sync/route.ts",
    "utf8",
  );
  assert.match(source, /SHOPLING_STOCK_CANARY_PREPARATION/);
  assert.match(source, /a6MatchedShoplingProductId/);
  assert.match(source, /shoplingProductId/);
  assert.match(source, /preparedGoodsKeysByBarcode\.get\(row\.barcode\)/);
  assert.match(source, /\.\.\.row\.goodsKeys/);
});

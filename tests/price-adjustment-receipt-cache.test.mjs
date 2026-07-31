import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("stores only the recent receipt evidence required by price protection", async () => {
  const cache = await source("../src/lib/priceAdjustmentReceiptCache.ts");
  assert.match(cache, /MAX_RECEIPTS_PER_BARCODE = 3/);
  assert.match(cache, /receiptsByBarcode/);
  assert.match(cache, /compareNewestFirst/);
  assert.match(cache, /slice\(0, MAX_RECEIPTS_PER_BARCODE\)/);
});

test("exposes authenticated receipt cache read and push endpoints", async () => {
  const [reader, writer] = await Promise.all([
    source("../src/app/api/integrations/price-adjustment/receipt-cache/route.ts"),
    source("../src/app/api/integrations/price-adjustment/receipt-cache/push/route.ts"),
  ]);
  assert.match(reader, /OPS_CENTER_RECEIPT_CACHE_NOT_READY/);
  assert.match(reader, /x-commerce-os-integration-secret/);
  assert.match(writer, /mergePriceAdjustmentReceiptCachePage/);
  assert.match(writer, /MAX_RECEIPTS_PER_PAGE = 500/);
  assert.match(writer, /실제 샵플링 가격/);
});

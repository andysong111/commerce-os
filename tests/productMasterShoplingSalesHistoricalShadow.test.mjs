import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [service, engine, cron, page] = await Promise.all([
  readFile("src/lib/productMasterShoplingSalesHistoricalShadow.ts", "utf8"),
  readFile("src/lib/productMasterShoplingSalesHistoricalShadowEngine.ts", "utf8"),
  readFile(
    "src/app/api/cron/product-master-shopling-sales-backfill/route.ts",
    "utf8",
  ),
  readFile(
    "src/app/product-master/shopling-sales-backfill/historical-shadow/page.tsx",
    "utf8",
  ),
]);

test("historical shadow rereads Shopling but never writes Product Master business ledgers", () => {
  assert.match(service, /ShoplingReadClient/);
  assert.match(service, /businessWritesPerformed: false/);
  assert.doesNotMatch(service, /api\/integrations\/barcode-ledgers/);
  assert.doesNotMatch(service, /sales-ledger.*method:\s*"POST"/i);
  assert.match(service, /commerce_operation_runs/);
});

test("promotion gate excludes volatile final range and requires three-way delta equality", () => {
  assert.match(service, /chunk\.range\.end < volatileEnd/);
  assert.match(service, /shadow\.fetchedRows === baseline!\.fetchedRows/);
  assert.match(service, /shadow\.ignoredRows === baseline!\.ignoredRows/);
  assert.match(service, /shadow\.duplicateRows === baseline!\.duplicateRows/);
  assert.match(service, /acceptedDelta === unmappedDelta/);
  assert.match(service, /acceptedDelta === stableTotals\.fallbackResolvedRows/);
  assert.match(service, /sourceShapeMatch &&\s*deltaConsistent/);
});

test("fallback requires exact option evidence plus goods key and direct-code compatibility", () => {
  assert.match(engine, /history\.barcodes\.size !== 1/);
  assert.match(engine, /activeListingCountByBarcode/);
  assert.match(engine, /candidate\.goodsKeys\.includes\(key\)/);
  assert.match(engine, /directCode && directCode !== candidate\.barcode/);
  assert.match(engine, /if \(!identity\) \{\s*const historical = resolveHistoricalFallback/);
});

test("existing sales cron starts shadow only after canonical baseline is BLOCKED", () => {
  assert.match(cron, /current\.state === "BLOCKED"/);
  assert.match(cron, /createProductMasterShoplingSalesHistoricalShadowRequest/);
  assert.match(cron, /runProductMasterShoplingSalesHistoricalShadowStep/);
  assert.doesNotMatch(cron, /shadowSafeToPromote[\s\S]*pushSales/);
});

test("shadow page does not expose order numbers or buyer data", () => {
  assert.doesNotMatch(page, /orderNo|orderLineId|buyer|buyerName|recipient|phone|address/i);
  assert.match(page, /주문번호·구매자정보는 표시하지 않습니다/);
  assert.match(page, /Product Master 판매원장·가격·발주·재고에는 쓰지 않습니다/);
});

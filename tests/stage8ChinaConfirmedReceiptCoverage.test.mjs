import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [source, audit, page] = await Promise.all([
  readFile("src/lib/confirmedReceiptHistorySource.ts", "utf8"),
  readFile("src/lib/stage8ChinaConfirmedReceiptCoverage.ts", "utf8"),
  readFile("src/app/stage8-china-confirmed-receipt-coverage/page.tsx", "utf8"),
]);

test("all-history receipt reader calls the existing read-only China receipt endpoint without a batch filter", () => {
  assert.match(source, /price-adjustment-receipts\?\$\{params\.toString\(\)\}/);
  assert.match(source, /new URLSearchParams\(\{ limit: String\(PAGE_LIMIT\) \}\)/);
  assert.doesNotMatch(source, /params\.set\("batchId"/);
  assert.match(source, /payload\.sourceWritesEnabled !== false/);
  assert.match(source, /payload\.filter !== null && payload\.filter !== undefined/);
});

test("history reader is paginated bounded and retries only known integration secrets for auth", () => {
  assert.match(source, /const MAX_PAGES = 10/);
  assert.match(source, /const PAGE_LIMIT = 5000/);
  assert.match(source, /CHINA_ORDER_MANAGER_INTEGRATION_SECRET/);
  assert.match(source, /PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET/);
  assert.match(source, /PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.match(source, /message\.startsWith\("CHINA_RECEIPT_HISTORY_AUTH:"\)/);
});

test("coverage audit compares current purchase-candidate B-codes against China and Product Master receipt quantities", () => {
  assert.match(audit, /loadConfirmedReceiptHistorySource/);
  assert.match(audit, /loadPurchaseCandidateShoplingIdentityAudit/);
  assert.match(audit, /loadProductMasterInventoryCostReadiness/);
  assert.match(audit, /SOURCE_SYNC_GAP/);
  assert.match(audit, /QUANTITY_MISMATCH/);
  assert.match(audit, /PARITY/);
  assert.match(audit, /NO_CONFIRMED_RECEIPT/);
});

test("receipt coverage audit never promotes current inventory or executes a purchase", () => {
  assert.match(audit, /currentInventoryPromotionAllowed: false/);
  assert.match(audit, /purchaseDecisionAllowed: false/);
  assert.match(audit, /purchaseWritesEnabled: false/);
  assert.match(audit, /inventoryWritesEnabled: false/);
  assert.match(page, /PURCHASE \/ INVENTORY WRITE 0/);
  assert.match(page, /확정입고가 있다고 초기 미확인 재고가 자동으로 정확해지는 것은 아닙니다/);
  assert.doesNotMatch(audit, /\.(insert|upsert|delete)\(/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [source, audit, page] = await Promise.all([
  readFile("src/lib/confirmedReceiptHistorySource.ts", "utf8"),
  readFile("src/lib/stage8ChinaConfirmedReceiptCoverage.ts", "utf8"),
  readFile("src/app/stage8-china-confirmed-receipt-coverage/page.tsx", "utf8"),
]);

test("receipt reader uses the dedicated bounded China B-code filter endpoint", () => {
  assert.match(source, /confirmed-receipts-by-barcodes\?\$\{params\.toString\(\)\}/);
  assert.match(source, /barcodes: input\.barcodes\.join\(","\)/);
  assert.match(source, /const MAX_BARCODES = 200/);
  assert.match(source, /const MANAGED_BARCODE = \/\^B\[A-Z\]\{2\}\\d\+-\\d\+\$\//);
  assert.doesNotMatch(source, /price-adjustment-receipts\?\$\{params\.toString\(\)\}/);
});

test("reader requires the China source to echo the exact requested barcode scope", () => {
  assert.match(source, /exactBarcodeFilter\(payload, requested\)/);
  assert.match(source, /CHINA_RECEIPT_HISTORY_BARCODE_FILTER_NOT_ENFORCED/);
  assert.match(source, /requestedSet\.has\(row\.barcode\)/);
  assert.match(source, /CHINA_RECEIPT_HISTORY_FOREIGN_BARCODE/);
  assert.match(source, /sourceWritesEnabled: false/);
});

test("targeted reader is paginated bounded and retries only known integration secrets on auth", () => {
  assert.match(source, /const MAX_PAGES = 10/);
  assert.match(source, /const PAGE_LIMIT = 5000/);
  assert.match(source, /CHINA_ORDER_MANAGER_INTEGRATION_SECRET/);
  assert.match(source, /PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET/);
  assert.match(source, /PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.match(source, /message\.startsWith\("CHINA_RECEIPT_HISTORY_AUTH:"\)/);
});

test("coverage loads candidates first and sends only those B-codes to China", () => {
  assert.match(audit, /loadPurchaseCandidateShoplingIdentityAudit/);
  assert.match(audit, /loadProductMasterInventoryCostReadiness/);
  assert.match(audit, /const candidateBarcodeList = candidates\.rows/);
  assert.match(audit, /loadConfirmedReceiptHistorySource\(candidateBarcodeList\)/);
  assert.match(audit, /CHINA_RECEIPT_COVERAGE_FILTER_SCOPE_MISMATCH/);
  assert.match(audit, /foreignBarcodeRowCount: 0/);
  assert.match(page, /FILTER CONTRACT VERIFIED · FOREIGN BARCODE ROWS 0/);
});

test("coverage audit still distinguishes sync gaps mismatches parity and no receipts", () => {
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

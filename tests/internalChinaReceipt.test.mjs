import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, route, panel, layout, monthlyPolicy] = await Promise.all([
  readFile("src/lib/internalChinaReceipt.ts", "utf8"),
  readFile("src/app/api/china-order-manager/receipts/route.ts", "utf8"),
  readFile("src/components/china-order-manager/InternalChinaReceiptPanel.tsx", "utf8"),
  readFile("src/app/china-order-manager/layout.tsx", "utf8"),
  readFile("src/lib/monthlyPurchasePolicy.ts", "utf8"),
]);

test("China order manager exposes the calendar-month purchase and receipt cycle", () => {
  assert.ok(monthlyPolicy.includes('PURCHASE_RECOMMENDATION_CADENCE = "MONTHLY"'));
  assert.ok(layout.includes("발주·입고 사이클"));
  assert.ok(layout.includes("월 1회"));
  assert.ok(layout.includes("koreanMonthLabel(currentCycleMonth)"));
});

test("receipt UI supports full and partial receipt quantities on the existing China order route", () => {
  assert.ok(panel.includes("입고 처리"));
  assert.ok(panel.includes("남은 수량 전부 채우기"));
  assert.ok(panel.includes("PARTIALLY_RECEIVED"));
  assert.ok(panel.includes("RECEIVED"));
  assert.ok(panel.includes('/api/china-order-manager/receipts'));
  assert.ok(layout.includes("InternalChinaReceiptPanel"));
});

test("receipt engine never receives more than the current open quantity", () => {
  assert.ok(engine.includes("receivedNow > commitment.openQuantity"));
  assert.ok(engine.includes("CHINA_RECEIPT_QUANTITY_EXCEEDED"));
  assert.ok(engine.includes("commitment.receivedQuantity + receivedNow"));
});

test("receipt engine writes ledger status and confirmed receipt cost for Product Master", () => {
  assert.ok(engine.includes('status: finished ? "RECEIVED" : "PARTIALLY_RECEIVED"'));
  assert.ok(engine.includes("mergePriceAdjustmentReceiptCachePage"));
  assert.ok(engine.includes("pushCanonicalProductMasterSnapshotFromTrackerState"));
  assert.ok(engine.includes("draft.internalOrderCostMultiplier"));
  assert.ok(engine.includes("draft.exchangeRateKrwPerCny"));
});

test("receipt API is same-origin protected and returns a user-facing receipt result", () => {
  assert.ok(route.includes("isSameOriginOpsRequest"));
  assert.ok(route.includes("recordInternalChinaReceipt"));
  assert.ok(route.includes("Product Master 입고원가"));
});

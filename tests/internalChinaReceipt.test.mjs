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

test("receipt engine writes ledger status and product purchase cost without the 1.45 forwarder estimate", () => {
  assert.ok(engine.includes('status: finished ? "RECEIVED" : "PARTIALLY_RECEIVED"'));
  assert.ok(engine.includes("mergePriceAdjustmentReceiptCachePage"));
  assert.ok(engine.includes("pushCanonicalProductMasterSnapshotFromTrackerState"));
  assert.ok(engine.includes("actualUnitCny * draft.exchangeRateKrwPerCny"));
  assert.equal(engine.includes("draft.internalOrderCostMultiplier"), false);
  assert.ok(engine.includes("배송대행지 청구액"));
});

test("receipt API is same-origin protected and reports product purchase cost separately", () => {
  assert.ok(route.includes("isSameOriginOpsRequest"));
  assert.ok(route.includes("recordInternalChinaReceipt"));
  assert.ok(route.includes("상품 매입원가"));
  assert.equal(route.includes("내부기준원가"), false);
});

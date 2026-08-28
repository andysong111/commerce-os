import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, route, panel, layout, receiptEngine, workflow] = await Promise.all([
  readFile("src/lib/internalChinaForwarderCost.ts", "utf8"),
  readFile("src/app/api/china-order-manager/forwarder-cost/route.ts", "utf8"),
  readFile("src/components/china-order-manager/InternalChinaReceiptPanel.tsx", "utf8"),
  readFile("src/app/china-order-manager/layout.tsx", "utf8"),
  readFile("src/lib/internalChinaReceipt.ts", "utf8"),
  readFile(".github/workflows/china-order-ledger-ci.yml", "utf8"),
]);

test("actual forwarder charges are persisted as a separate monthly cash-out ledger", () => {
  assert.ok(
    engine.includes(
      'INTERNAL_CHINA_FORWARDER_COST_CLOSE',
    ),
  );
  assert.ok(engine.includes("actualCostKrw"));
  assert.ok(engine.includes("estimatedForwarderCostKrw"));
  assert.ok(engine.includes("actualTotalOutflowKrw"));
  assert.ok(engine.includes("appliesToProductUnitCost: false"));
  assert.ok(engine.includes("appliesToPriceGrade: false"));
  assert.ok(engine.includes("CHINA_FORWARDER_COST_RECEIPT_OPEN"));
});

test("receipt close requires the exact forwarder amount only for the final receipt", () => {
  assert.ok(panel.includes("배송대행지 실제비용(원)"));
  assert.ok(panel.includes("selectedQuantity === remainingTotal"));
  assert.ok(panel.includes("actualForwarderCostKrw <= 0"));
  assert.ok(panel.includes('/api/china-order-manager/forwarder-cost'));
  assert.ok(panel.includes("부분입고"));
  assert.ok(panel.includes("최종 전량 입고"));
});

test("completed monthly drafts remain visible until forwarder cost is closed", () => {
  assert.ok(layout.includes("draft.orderedQuantity > 0"));
  assert.ok(layout.includes("currentCycleDrafts.map"));
  assert.ok(layout.includes("배송비 미마감"));
  assert.ok(layout.includes("loadInternalChinaForwarderCostSummary"));
});

test("forwarder cost API is same-origin protected and never claims price inclusion", () => {
  assert.ok(route.includes("isSameOriginOpsRequest"));
  assert.ok(route.includes("recordInternalChinaForwarderCost"));
  assert.ok(route.includes("상품 매입원가·판매가·상품등급 계산에는 합산하지 않습니다"));
});

test("Product Master receipt cost excludes the temporary 1.45 estimate", () => {
  assert.ok(receiptEngine.includes("actualUnitCny * draft.exchangeRateKrwPerCny"));
  assert.equal(receiptEngine.includes("draft.internalOrderCostMultiplier"), false);
});

test("the forwarder regression suite is permanently wired into China Order Ledger CI", () => {
  assert.ok(workflow.includes('src/lib/internalChinaForwarderCost.ts'));
  assert.ok(workflow.includes('src/app/api/china-order-manager/forwarder-cost/route.ts'));
  assert.ok(workflow.includes('tests/internalChinaForwarderCost.test.mjs'));
  assert.ok(
    workflow.includes(
      'node --experimental-strip-types --test',
    ),
  );
});

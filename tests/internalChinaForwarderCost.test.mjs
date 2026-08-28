import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, route, panel, fallbackPanel, layout, receiptEngine, workflow] = await Promise.all([
  readFile("src/lib/internalChinaForwarderCost.ts", "utf8"),
  readFile("src/app/api/china-order-manager/forwarder-cost/route.ts", "utf8"),
  readFile("src/components/china-order-manager/InternalChinaReceiptPanel.tsx", "utf8"),
  readFile("src/components/china-order-manager/InternalChinaForwarderCostFallback.tsx", "utf8"),
  readFile("src/app/china-order-manager/layout.tsx", "utf8"),
  readFile("src/lib/internalChinaReceipt.ts", "utf8"),
  readFile(".github/workflows/china-order-ledger-ci.yml", "utf8"),
]);

test("actual forwarder charges are persisted as a separate monthly cash-out ledger", () => {
  assert.ok(engine.includes('INTERNAL_CHINA_FORWARDER_COST_CLOSE'));
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

test("China order manager fails fast instead of exhausting the Vercel function timeout", () => {
  assert.ok(layout.includes("RECEIPT_LEDGER_TIMEBOX_MS = 4_500"));
  assert.ok(layout.includes("DISPLAY_METADATA_TIMEBOX_MS = 2_500"));
  assert.ok(layout.includes("FORWARDER_SUMMARY_TIMEBOX_MS = 4_500"));
  assert.ok(layout.includes("Promise.race"));
  assert.ok(layout.includes("발주원장 실시간 조회 지연"));
  assert.ok(layout.includes("실제 원장 데이터는 변경되지 않았습니다"));
  assert.ok(layout.includes("상품 표시정보 조회가 지연되어 B-code 중심으로 먼저 화면을 열었습니다"));
});

test("forwarder amount input remains available even when the cost summary times out", () => {
  assert.ok(layout.includes("InternalChinaForwarderCostFallback"));
  assert.ok(layout.includes("실제비용 입력 기능은 계속 사용할 수 있습니다"));
  assert.ok(fallbackPanel.includes("배송대행지 실제비용(원)"));
  assert.ok(fallbackPanel.includes("배송대행 비용 마감"));
  assert.ok(fallbackPanel.includes('/api/china-order-manager/forwarder-cost'));
  assert.ok(fallbackPanel.includes("상품 원가·판매가·상품등급에는 합산하지 않습니다"));
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

test("closing the forwarding expense repairs same-cycle receipt cache rows before Product Master sync", () => {
  assert.ok(engine.includes("readPriceAdjustmentReceiptCache"));
  assert.ok(engine.includes("mergePriceAdjustmentReceiptCachePage"));
  assert.ok(engine.includes('row.id.startsWith("china-receipt:")'));
  assert.ok(engine.includes("row.batchId !== cycleBatchId"));
  assert.ok(engine.includes("unitCostKrw: nextUnitCostKrw"));
  assert.ok(engine.includes("pushCanonicalProductMasterSnapshotFromTrackerState"));
  assert.ok(route.includes("1.45를 제거한 상품대금·중국내 운임 기준"));
});

test("the forwarder regression suite is permanently wired into China Order Ledger CI", () => {
  assert.ok(workflow.includes('src/lib/internalChinaForwarderCost.ts'));
  assert.ok(workflow.includes('src/app/api/china-order-manager/forwarder-cost/route.ts'));
  assert.ok(workflow.includes('tests/internalChinaForwarderCost.test.mjs'));
  assert.ok(workflow.includes('node --experimental-strip-types --test'));
});
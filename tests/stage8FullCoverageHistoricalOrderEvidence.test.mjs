import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [evidence, engine, page] = await Promise.all([
  readFile("src/data/stage8FullCoverageHistoricalOrderEvidence.ts", "utf8"),
  readFile("src/lib/stage8FullCoverageHistoricalOrderEvidence.ts", "utf8"),
  readFile("src/app/stage8-fullcoverage-historical-order-evidence/page.tsx", "utf8"),
]);

test("historical order evidence is source pinned and explicitly not confirmed inbound", () => {
  assert.match(evidence, /1차_중국발주이력_안전원가_안전판매가_신규산출\.xlsx/);
  assert.match(evidence, /sourceSheets: \["모델번호별 요약", "상품별 안전원가"\]/);
  assert.match(evidence, /confirmedInbound: false/);
  assert.match(evidence, /currentInventoryUseAllowed: false/);
  assert.match(evidence, /validationOnly: true/);
});

test("BBA2-3 aaa092 source evidence preserves cumulative recent-three and latest option quantities", () => {
  assert.match(evidence, /barcode: "BBA2-3"/);
  assert.match(evidence, /originalModelNo: "aaa092"/);
  assert.match(evidence, /cumulativeOrderQuantity: 4980/);
  assert.match(evidence, /recentThreeOrderQuantity: 4370/);
  assert.match(evidence, /latestOrderDate: "2026-04-01"/);
  for (const quantity of [150, 200]) {
    assert.match(evidence, new RegExp(`orderQuantity: ${quantity}`));
  }
  assert.match(engine, /latestOrderQuantity/);
  assert.match(engine, /evidence\.latestOrderRows\.reduce/);
});

test("only a single-model full-coverage crosswalk can expose order history as provisional input evidence", () => {
  assert.match(engine, /loadHistoricalGoodsKeyModelCrosswalk/);
  assert.match(engine, /candidate\.state === "SINGLE_MODEL_FULL_COVERAGE"/);
  assert.match(engine, /candidate\.originalModelNos\.length === 1/);
  assert.match(engine, /MODEL_CROSSWALK_MISMATCH/);
  assert.match(engine, /NO_ORDER_EVIDENCE/);
  assert.match(engine, /provisionalEstimateInputEligible: true/);
});

test("order history never becomes current inventory or a purchase decision", () => {
  assert.match(engine, /confirmedInbound: false/);
  assert.match(engine, /currentInventoryUseAllowed: false/);
  assert.match(engine, /operationalEstimatePromotionAllowed: false/);
  assert.match(engine, /purchaseDecisionAllowed: false/);
  assert.match(engine, /inventoryPromotionAllowed: false/);
  assert.match(engine, /purchaseWritesEnabled: false/);
  assert.match(engine, /inventoryWritesEnabled: false/);
  assert.match(page, /ORDER HISTORY ≠ CONFIRMED INBOUND ≠ CURRENT INVENTORY/);
  assert.match(page, /PURCHASE \/ INVENTORY WRITE 0/);
  assert.doesNotMatch(engine, /createSupabaseAdminClient/);
  assert.doesNotMatch(engine, /\.(insert|upsert|delete)\(/);
  assert.doesNotMatch(engine, /fetch\(/);
});

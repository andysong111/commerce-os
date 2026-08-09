import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page] = await Promise.all([
  readFile("src/lib/stage8ProvisionalEstimateCandidate.ts", "utf8"),
  readFile("src/app/stage8-provisional-estimate-candidate/page.tsx", "utf8"),
]);

test("candidate consumes only full-coverage order history plus exact canonical sales", () => {
  assert.match(engine, /loadFullCoverageHistoricalOrderEvidence/);
  assert.match(engine, /loadStage8CanonicalSalesEventSnapshot/);
  assert.match(engine, /row\.state === "ORDER_HISTORY_READY_NOT_INBOUND"/);
  assert.match(engine, /Date\.parse\(event\.occurredAt\) >= assumedReceiptMs/);
  assert.match(engine, /latestOrderQuantity - canonicalSalesSinceAssumedReceipt/);
});

test("lead-time scenario is fixed to fourteen days and fails closed on sales coverage gaps", () => {
  assert.match(engine, /const OPERATING_LEAD_DAYS = 14/);
  assert.match(engine, /datePlusDays\(latestOrderDate, OPERATING_LEAD_DAYS\)/);
  assert.match(engine, /assumedReceiptMs < coverageStartMs/);
  assert.match(engine, /"SALES_COVERAGE_GAP"/);
});

test("receipt assumptions are simulated through the existing net-requirement engine", () => {
  assert.match(engine, /calculateNetRequirement/);
  assert.match(engine, /const noReceipt = calculate\(0\)/);
  assert.match(engine, /const fullReceipt = calculate\(latestOrderResidualCandidate\)/);
  assert.match(engine, /"ORDER_DIRECTION_STABLE"/);
  assert.match(engine, /"HOLD_DIRECTION_STABLE"/);
  assert.match(engine, /"RECEIPT_ASSUMPTION_SENSITIVE"/);
});

test("residual candidate is never labeled as current inventory or a proven bound", () => {
  assert.match(engine, /candidateIsCurrentInventory: false/);
  assert.match(engine, /candidateIsInventoryBound: false/);
  assert.match(engine, /preexistingStockUnknown: true/);
  assert.match(engine, /receiptConfirmationMissing: true/);
  assert.match(page, /이 잔여후보는 현재재고가 아닙니다/);
  assert.match(page, /실제재고·재고상한·재고하한이 아닙니다/);
});

test("candidate cannot promote inventory or execute a purchase", () => {
  assert.match(engine, /provisionalEstimatePromotionAllowed: false/);
  assert.match(engine, /inventoryUseAllowed: false/);
  assert.match(engine, /purchaseDecisionAllowed: false/);
  assert.match(engine, /actualDraftCreationEnabled: false/);
  assert.match(engine, /purchaseWritesEnabled: false/);
  assert.match(engine, /inventoryWritesEnabled: false/);
  assert.match(page, /INVENTORY \/ PURCHASE WRITE 0/);
  assert.doesNotMatch(engine, /\.(insert|upsert|delete)\(/);
  assert.doesNotMatch(engine, /fetch\(/);
});

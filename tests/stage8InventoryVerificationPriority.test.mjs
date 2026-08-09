import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page] = await Promise.all([
  readFile("src/lib/stage8InventoryVerificationPriority.ts", "utf8"),
  readFile("src/app/stage8-inventory-verification-priority/page.tsx", "utf8"),
]);

test("provisional inventory readiness is read only and joins canonical demand to Product Master inventory and planning", () => {
  assert.match(engine, /loadCanonicalPurchaseShadow/);
  assert.match(engine, /loadProductMasterInventoryCostReadiness/);
  assert.match(engine, /loadProductPlanningSnapshot/);
  assert.match(engine, /writesEnabled: false/);
  assert.match(page, /0 · READ ONLY|재고실사 필수/);
});

test("initial zero unverified inventory is an explicit provisional mode instead of a stocktake blocker", () => {
  assert.match(engine, /"PROVISIONAL"/);
  assert.match(engine, /if \(row\.inventoryVerified\) return "VERIFIED"/);
  assert.match(engine, /return "PROVISIONAL"/);
  assert.doesNotMatch(engine, /STOCKTAKE_REQUIRED/);
  assert.match(page, /INITIAL_ZERO\/UNVERIFIED라도 원장이 음수가 아니면 PROVISIONAL/);
  assert.match(page, /STOCKTAKE는 오류 교정용 선택 기능이지 필수 절차가 아닙니다/);
});

test("provisional quantity and open commitment are subtracted from gross demand using the existing net-requirement engine", () => {
  assert.match(engine, /calculateNetRequirement/);
  assert.match(engine, /availableQuantity: inventoryUsable/);
  assert.match(engine, /inventory\?\.inventoryQuantity/);
  assert.match(engine, /ledgerCommitment: openCommitment/);
  assert.match(engine, /moq:/);
  assert.match(engine, /cartonQuantity:/);
  assert.match(page, /기존 gross 권장수량에서 PROVISIONAL\/VERIFIED 재고와 중국 미입고 약정을 다시 차감/);
});

test("negative or review inventory still fails closed", () => {
  assert.match(engine, /row\.inventoryRequiresReview \|\| row\.inventoryVerification === "REVIEW"/);
  assert.match(engine, /LEDGER_REVIEW_REQUIRED/);
  assert.match(page, /원장 음수·identity 충돌은 REVIEW로 차단/);
});

test("confirmed receipt cost remains a separate operational gate", () => {
  assert.match(engine, /!row\?\.hasConfirmedReceiptCost/);
  assert.match(engine, /COST_CONFIRMATION_REQUIRED/);
  assert.match(page, /확정 입고원가는 재고 신뢰도와 별개로 발주·가격 판단의 비용 게이트/);
});

test("sold out reset is the normal path from provisional to verified inventory", () => {
  assert.match(page, /SOLD_OUT_RESET=0부터 VERIFIED/);
  assert.match(page, /품절이 실제 확인되면 SOLD_OUT_RESET=0을 기준점/);
  assert.match(engine, /stocktakeRequiredCount: 0/);
});

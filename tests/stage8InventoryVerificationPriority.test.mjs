import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page] = await Promise.all([
  readFile("src/lib/stage8InventoryVerificationPriority.ts", "utf8"),
  readFile("src/app/stage8-inventory-verification-priority/page.tsx", "utf8"),
]);

test("inventory verification priority is read only and joins canonical purchase demand to Product Master inventory trust", () => {
  assert.match(engine, /loadCanonicalPurchaseShadow/);
  assert.match(engine, /loadProductMasterInventoryCostReadiness/);
  assert.match(engine, /writesEnabled: false/);
  assert.doesNotMatch(engine, /fetch\(/);
  assert.doesNotMatch(engine, /recordInventoryEvent/);
  assert.match(page, /0 · READ ONLY/);
});

test("initial zero inventory is never treated as real verified zero", () => {
  assert.match(engine, /!row\.inventoryVerified \|\| row\.initialZeroUnverified/);
  assert.match(engine, /STOCKTAKE_REQUIRED/);
  assert.match(page, /초기 0을 실제 재고로 믿지 않고 실사 필요/);
});

test("negative or review inventory requires ledger review before stocktake", () => {
  assert.match(engine, /row\.inventoryRequiresReview/);
  assert.match(engine, /LEDGER_REVIEW_REQUIRED/);
  assert.match(page, /원장 검토 우선/);
});

test("confirmed receipt cost remains a separate operational gate", () => {
  assert.match(engine, /!row\.hasConfirmedReceiptCost/);
  assert.match(engine, /COST_CONFIRMATION_REQUIRED/);
  assert.match(page, /확정 입고원가가 없으면 실제 발주\/가격 판단에서 차단/);
});

test("operational readiness is granted per purchase candidate only after both inventory and cost are trusted", () => {
  assert.match(engine, /product\.status === "발주 추천"/);
  assert.match(engine, /action === "NONE"/);
  assert.match(engine, /product\.inventoryKnown === true/);
  assert.match(page, /검증된 SKU만 독립적으로 잠금 해제/);
});

test("priority queue minimizes direct stocktake work by expected purchase spend", () => {
  assert.match(engine, /spendCoverageCount/);
  assert.match(engine, /target = 0\.8/);
  assert.match(engine, /right\.expectedCost - left\.expectedCost/);
  assert.match(engine, /priorityStocktakeCountFor80PctBlockedSpend/);
  assert.match(page, /우선 확인 묶음 · 차단금액 약 80%/);
});

test("priority coverage never unlocks unverified rows", () => {
  assert.match(page, /80% 커버 수치는 작업량을 줄이기 위한 우선순위일 뿐/);
  assert.match(page, /실사하지 않은 SKU를 0재고로 간주하거나 자동 발주에 포함하지 않습니다/);
});

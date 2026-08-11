import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [audit, page, card] = await Promise.all([
  readFile("src/lib/internalChinaPurchaseBudgetAudit.ts", "utf8"),
  readFile("src/app/china-order-manager/drafts/[draftId]/page.tsx", "utf8"),
  readFile(
    "src/components/china-order-manager/InternalChinaPurchaseBudgetAudit.tsx",
    "utf8",
  ),
]);

test("China order draft audits the established monthly purchase budget formula", () => {
  assert.match(audit, /recent30RevenueKrw \/ 2/);
  assert.match(audit, /DEFAULT_PURCHASE_COST_MULTIPLIER/);
  assert.match(audit, /calculateProductOrderBudget/);
  assert.match(audit, /productOrderBudgetKrw/);
  assert.match(audit, /selectedDraftEstimatedProductCostKrw/);
  assert.match(audit, /selectedDraftEstimatedLandedCostKrw/);
});

test("manual draft quantities are compared with the engine allocated quantities", () => {
  assert.match(audit, /engineRecommendedQuantity/);
  assert.match(audit, /quantityDeltaFromEngine/);
  assert.match(audit, /quantityAboveEngineCount/);
  assert.match(audit, /quantityBelowEngineCount/);
});

test("other active RESERVED drafts are surfaced before the operator orders", () => {
  assert.match(audit, /otherActiveDraftCount/);
  assert.match(audit, /otherActiveDraftQuantity/);
  assert.match(audit, /otherActiveDraftEstimatedProductCostKrw/);
  assert.match(card, /다른 활성 Draft/);
  assert.match(card, /과거 Draft라면 이후 해제/);
});

test("budget amount is visible on the actual internal China draft page", () => {
  assert.match(page, /loadInternalChinaPurchaseBudgetAudit/);
  assert.match(page, /InternalChinaPurchaseBudgetAudit/);
  assert.match(card, /전월 매출원가 기준 발주예산 검증/);
  assert.match(card, /상품대금 발주한도/);
  assert.match(card, /현재 Draft 추정 상품대금/);
  assert.match(card, /예산 초과/);
});

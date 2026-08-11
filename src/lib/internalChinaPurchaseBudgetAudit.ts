import { loadChinaOrderLedger } from "@/lib/chinaOrderLedger";
import { loadInternalChinaPurchaseDraft } from "@/lib/internalChinaPurchaseDraft";
import {
  DEFAULT_PURCHASE_COST_MULTIPLIER,
  calculateProductOrderBudget,
} from "@/lib/productDecisionEngine/portfolio";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadCanonicalPurchaseShadow } from "@/lib/stage8CanonicalPurchaseShadow";

const SOURCE_SYSTEM = "fast-purchase-mvp";

export type InternalChinaPurchaseBudgetAuditStatus =
  | "WITHIN_BUDGET"
  | "OVER_BUDGET"
  | "COST_REVIEW";

export type InternalChinaPurchaseBudgetAuditLine = {
  barcode: string;
  quantity: number;
  referenceUnitCostKrw: number;
  estimatedProductCostKrw: number;
  engineRecommendedQuantity: number;
  engineExpectedCostKrw: number;
  quantityDeltaFromEngine: number;
};

export type InternalChinaPurchaseBudgetAudit = {
  generatedAt: string;
  analysisAsOf: string | null;
  basisLabel: string;
  recent30RevenueKrw: number;
  grossCogsBudgetKrw: number;
  purchaseCostMultiplier: number;
  productOrderBudgetKrw: number;
  engineExpectedSpendKrw: number;
  selectedDraftEstimatedProductCostKrw: number;
  selectedDraftEstimatedLandedCostKrw: number;
  selectedDraftBudgetRemainingKrw: number;
  selectedDraftBudgetOverKrw: number;
  selectedDraftBudgetUtilizationPercent: number;
  allActiveDraftEstimatedProductCostKrw: number;
  otherActiveDraftEstimatedProductCostKrw: number;
  otherActiveDraftQuantity: number;
  otherActiveDraftCount: number;
  missingCostBarcodes: string[];
  quantityChangedFromEngineCount: number;
  quantityAboveEngineCount: number;
  quantityBelowEngineCount: number;
  status: InternalChinaPurchaseBudgetAuditStatus;
  lines: InternalChinaPurchaseBudgetAuditLine[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export async function loadInternalChinaPurchaseBudgetAudit(
  draftId: string,
): Promise<InternalChinaPurchaseBudgetAudit> {
  const [draft, shadow, planning, ledger] = await Promise.all([
    loadInternalChinaPurchaseDraft(draftId),
    loadCanonicalPurchaseShadow(),
    loadProductPlanningSnapshot(),
    loadChinaOrderLedger(),
  ]);

  const snapshot = shadow.snapshot;
  const recent30RevenueKrw = money(shadow.recent30Revenue);
  const grossCogsBudgetKrw = money(recent30RevenueKrw / 2);
  const purchaseCostMultiplier = DEFAULT_PURCHASE_COST_MULTIPLIER;
  const productOrderBudgetKrw = money(
    snapshot?.budget ??
      calculateProductOrderBudget(grossCogsBudgetKrw, purchaseCostMultiplier),
  );
  const engineExpectedSpendKrw = money(snapshot?.expectedSpend);

  const planningByBarcode = new Map(
    planning.products
      .filter((row) => row.skuActive !== false)
      .map((row) => [barcode(row.barcode), row] as const),
  );
  const engineByBarcode = new Map(
    (snapshot?.products ?? [])
      .map((row) => [barcode(row.barcode), row] as const)
      .filter(([key]) => Boolean(key)),
  );

  function referenceUnitCostKrw(key: string) {
    const profile = planningByBarcode.get(key);
    const stored = money(profile?.latestCostKrw);
    if (stored > 0) return stored;
    const engine = engineByBarcode.get(key);
    const recommended = quantity(engine?.recommendedQty);
    const expectedCost = money(engine?.expectedCost);
    return recommended > 0 && expectedCost > 0
      ? Math.round(expectedCost / recommended)
      : 0;
  }

  const lines: InternalChinaPurchaseBudgetAuditLine[] = draft.lines.map((line) => {
    const key = barcode(line.barcode);
    const unitCost = referenceUnitCostKrw(key);
    const engine = engineByBarcode.get(key);
    const engineRecommendedQuantity = quantity(engine?.recommendedQty);
    const engineExpectedCostKrw = money(engine?.expectedCost);
    return {
      barcode: key,
      quantity: quantity(line.quantity),
      referenceUnitCostKrw: unitCost,
      estimatedProductCostKrw: money(unitCost * quantity(line.quantity)),
      engineRecommendedQuantity,
      engineExpectedCostKrw,
      quantityDeltaFromEngine:
        quantity(line.quantity) - engineRecommendedQuantity,
    };
  });

  const missingCostBarcodes = lines
    .filter((line) => line.referenceUnitCostKrw <= 0)
    .map((line) => line.barcode);
  const selectedDraftEstimatedProductCostKrw = lines.reduce(
    (sum, line) => sum + line.estimatedProductCostKrw,
    0,
  );
  const selectedDraftEstimatedLandedCostKrw = money(
    selectedDraftEstimatedProductCostKrw * purchaseCostMultiplier,
  );
  const selectedDraftBudgetRemainingKrw = Math.max(
    0,
    productOrderBudgetKrw - selectedDraftEstimatedProductCostKrw,
  );
  const selectedDraftBudgetOverKrw = Math.max(
    0,
    selectedDraftEstimatedProductCostKrw - productOrderBudgetKrw,
  );
  const selectedDraftBudgetUtilizationPercent =
    productOrderBudgetKrw > 0
      ? Math.round(
          (selectedDraftEstimatedProductCostKrw / productOrderBudgetKrw) *
            10_000,
        ) / 100
      : 0;

  const activeCommitments = ledger.commitments.filter(
    (row) =>
      row.sourceSystem === SOURCE_SYSTEM &&
      row.openQuantity > 0 &&
      row.sourceRunId,
  );
  const activeDraftIds = new Set(
    activeCommitments.map((row) => text(row.sourceRunId)).filter(Boolean),
  );
  let allActiveDraftEstimatedProductCostKrw = 0;
  let otherActiveDraftEstimatedProductCostKrw = 0;
  let otherActiveDraftQuantity = 0;
  for (const commitment of activeCommitments) {
    const unitCost = referenceUnitCostKrw(barcode(commitment.barcode));
    const estimated = money(unitCost * quantity(commitment.openQuantity));
    allActiveDraftEstimatedProductCostKrw += estimated;
    if (text(commitment.sourceRunId) !== draft.draftId) {
      otherActiveDraftEstimatedProductCostKrw += estimated;
      otherActiveDraftQuantity += quantity(commitment.openQuantity);
    }
  }

  const quantityChangedFromEngineCount = lines.filter(
    (line) => line.quantityDeltaFromEngine !== 0,
  ).length;
  const quantityAboveEngineCount = lines.filter(
    (line) => line.quantityDeltaFromEngine > 0,
  ).length;
  const quantityBelowEngineCount = lines.filter(
    (line) => line.quantityDeltaFromEngine < 0,
  ).length;

  const status: InternalChinaPurchaseBudgetAuditStatus =
    missingCostBarcodes.length > 0 || productOrderBudgetKrw <= 0
      ? "COST_REVIEW"
      : selectedDraftEstimatedProductCostKrw > productOrderBudgetKrw
        ? "OVER_BUDGET"
        : "WITHIN_BUDGET";

  return {
    generatedAt: new Date().toISOString(),
    analysisAsOf: shadow.analysisAsOf,
    basisLabel:
      snapshot?.budgetBasis ||
      `최근30일 정상매출 ${recent30RevenueKrw.toLocaleString("ko-KR")}원 ÷ 2 · 배송대행 포함 배수 ${purchaseCostMultiplier.toFixed(2)}`,
    recent30RevenueKrw,
    grossCogsBudgetKrw,
    purchaseCostMultiplier,
    productOrderBudgetKrw,
    engineExpectedSpendKrw,
    selectedDraftEstimatedProductCostKrw,
    selectedDraftEstimatedLandedCostKrw,
    selectedDraftBudgetRemainingKrw,
    selectedDraftBudgetOverKrw,
    selectedDraftBudgetUtilizationPercent,
    allActiveDraftEstimatedProductCostKrw,
    otherActiveDraftEstimatedProductCostKrw,
    otherActiveDraftQuantity,
    otherActiveDraftCount: Math.max(
      0,
      activeDraftIds.size - (activeDraftIds.has(draft.draftId) ? 1 : 0),
    ),
    missingCostBarcodes,
    quantityChangedFromEngineCount,
    quantityAboveEngineCount,
    quantityBelowEngineCount,
    status,
    lines,
  };
}

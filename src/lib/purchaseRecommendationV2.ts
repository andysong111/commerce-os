import { createHash } from "node:crypto";
import { openChinaOrderCommitmentsByBarcode } from "@/lib/chinaOrderLedger";
import { loadInternalChinaMonthlyPurchaseSummary } from "@/lib/internalChinaMonthlyPurchaseSummary";
import { loadInventoryLifecycleSnapshot } from "@/lib/inventoryLifecycleLedger";
import { monthlyPurchaseCycleFor } from "@/lib/monthlyPurchasePolicy";
import {
  allocatePurchaseV2Portfolio,
  calculatePurchaseV2Product,
  PURCHASE_V2_RULE_VERSION,
  type PurchaseV2AllocatedItem,
  type PurchaseV2DemandPattern,
  type PurchaseV2DecisionGroup,
} from "@/lib/productDecisionEngine/purchaseV2";
import { loadProductMasterCanonicalSalesAudit } from "@/lib/productMasterCanonicalSalesAudit";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadProvisionalInventoryDiagnostics } from "@/lib/stage8ProvisionalInventoryDiagnostics";
import { loadCanonicalPurchaseShadow } from "@/lib/stage8CanonicalPurchaseShadow";

export type PurchaseRecommendationV2Row = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  pattern: PurchaseV2DemandPattern;
  group: PurchaseV2DecisionGroup;
  monthlyDemandForecast: number;
  targetDemand44Days: number;
  observedRecent30Units: number;
  adjustedRecent30Units: number;
  stockoutRecoveredUnits: number;
  priceChangeRate: number | null;
  priceSignal: string;
  exactInventoryKnown: boolean;
  inventoryLowQuantity: number | null;
  inventoryHighQuantity: number | null;
  openCommitment: number;
  preBudgetRecommendedQuantity: number;
  cashAllocatedQuantity: number;
  unitCostKrw: number;
  expectedProductCostKrw: number;
  expectedAllocatedProductCostKrw: number;
  priorityScore: number;
  urgencyScore: number;
  stabilityScore: number;
  growthScore: number;
  capitalEfficiencyScore: number;
  confidence: number;
  budgetReduced: boolean;
  allocation: {
    survival: number;
    steadyCore: number;
    growthProtection: number;
    fullFill: number;
  };
  reason: string;
  demandReasons: string[];
};

export type PurchaseRecommendationV2Report = {
  generatedAt: string;
  state: "READY" | "BLOCKED";
  ruleVersion: typeof PURCHASE_V2_RULE_VERSION;
  cycleMonth: string;
  budgetMonth: string;
  purchaseBudgetMonthRevenueKrw: number;
  maxGrossBudgetKrw: number;
  recorded1688SpendKrw: number;
  maxAdditionalGrossBudgetKrw: number;
  requestedCashKrw: number | null;
  effectiveCashKrw: number;
  cashClamped: boolean;
  purchaseCostMultiplier: number;
  productOrderBudgetKrw: number;
  expectedProductSpendKrw: number;
  expectedAllInSpendKrw: number;
  remainingCashKrw: number;
  evaluatedSkuCount: number;
  recommendedSkuCount: number;
  manualReviewSkuCount: number;
  budgetReducedSkuCount: number;
  patternCounts: Record<PurchaseV2DemandPattern, number>;
  groupCounts: Record<PurchaseV2DecisionGroup, number>;
  rows: PurchaseRecommendationV2Row[];
  blockers: string[];
  fingerprint: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value)
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function decimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function emptyPatternCounts(): Record<PurchaseV2DemandPattern, number> {
  return {
    GROWTH: 0,
    STEADY_CORE: 0,
    NORMAL: 0,
    DECLINING: 0,
    DORMANT: 0,
  };
}

function emptyGroupCounts(): Record<PurchaseV2DecisionGroup, number> {
  return {
    "발주 추천": 0,
    "소량 검토": 0,
    "발주 보류": 0,
    "수동 검토": 0,
    "데이터 부족": 0,
  };
}

function blockedReport(input: {
  generatedAt: string;
  cycleMonth: string;
  budgetMonth: string;
  budgetRevenue?: number;
  maxGrossBudget?: number;
  recordedSpend?: number;
  requestedCash?: number | null;
  blockers: string[];
}): PurchaseRecommendationV2Report {
  const maxGrossBudgetKrw = quantity(input.maxGrossBudget);
  const recorded1688SpendKrw = quantity(input.recordedSpend);
  return {
    generatedAt: input.generatedAt,
    state: "BLOCKED",
    ruleVersion: PURCHASE_V2_RULE_VERSION,
    cycleMonth: input.cycleMonth,
    budgetMonth: input.budgetMonth,
    purchaseBudgetMonthRevenueKrw: quantity(input.budgetRevenue),
    maxGrossBudgetKrw,
    recorded1688SpendKrw,
    maxAdditionalGrossBudgetKrw: Math.max(
      0,
      maxGrossBudgetKrw - recorded1688SpendKrw,
    ),
    requestedCashKrw:
      input.requestedCash === null || input.requestedCash === undefined
        ? null
        : quantity(input.requestedCash),
    effectiveCashKrw: 0,
    cashClamped: false,
    purchaseCostMultiplier: 1.45,
    productOrderBudgetKrw: 0,
    expectedProductSpendKrw: 0,
    expectedAllInSpendKrw: 0,
    remainingCashKrw: 0,
    evaluatedSkuCount: 0,
    recommendedSkuCount: 0,
    manualReviewSkuCount: 0,
    budgetReducedSkuCount: 0,
    patternCounts: emptyPatternCounts(),
    groupCounts: emptyGroupCounts(),
    rows: [],
    blockers: input.blockers,
    fingerprint: sha256({
      state: "BLOCKED",
      blockers: input.blockers,
      generatedAt: input.generatedAt,
    }),
  };
}

function rowFromAllocated(
  item: PurchaseV2AllocatedItem,
  modelNo: string | null,
  unitCostKrw: number,
): PurchaseRecommendationV2Row {
  return {
    barcode: item.barcode,
    modelNo,
    productName: item.name,
    pattern: item.demand.pattern,
    group: item.group,
    monthlyDemandForecast: item.demand.monthlyDemandForecast,
    targetDemand44Days: item.demand.targetDemand44Days,
    observedRecent30Units: quantity(item.demand.observedUnits[0]),
    adjustedRecent30Units: quantity(item.demand.adjustedUnits[0]),
    stockoutRecoveredUnits: item.demand.stockoutRecoveredUnits,
    priceChangeRate: item.demand.priceChangeRate,
    priceSignal: item.demand.priceSignal,
    exactInventoryKnown: item.exactInventoryKnown,
    inventoryLowQuantity: item.inventoryLowQuantity,
    inventoryHighQuantity: item.inventoryHighQuantity,
    openCommitment: item.openCommitment,
    preBudgetRecommendedQuantity: item.recommendedQuantity,
    cashAllocatedQuantity: item.allocatedQuantity,
    unitCostKrw,
    expectedProductCostKrw: item.expectedProductCost,
    expectedAllocatedProductCostKrw:
      item.expectedAllocatedProductCost,
    priorityScore: item.priorityScore,
    urgencyScore: item.urgencyScore,
    stabilityScore: item.stabilityScore,
    growthScore: item.growthScore,
    capitalEfficiencyScore: item.capitalEfficiencyScore,
    confidence: item.demand.confidence,
    budgetReduced: item.budgetReduced,
    allocation: {
      survival: item.survivalQuantity,
      steadyCore: item.steadyCoreQuantity,
      growthProtection: item.growthProtectionQuantity,
      fullFill: item.fullFillQuantity,
    },
    reason: item.reason,
    demandReasons: item.demand.reasons,
  };
}

export async function loadPurchaseRecommendationV2(input?: {
  cashKrw?: unknown;
  now?: Date;
}): Promise<PurchaseRecommendationV2Report> {
  const now = input?.now ?? new Date();
  const generatedAt = now.toISOString();
  const cycle = monthlyPurchaseCycleFor(generatedAt);
  const requestedCashKrw =
    input?.cashKrw === undefined || input.cashKrw === null
      ? null
      : quantity(input.cashKrw);
  const blockers: string[] = [];

  const [audit, planning, diagnostics, lifecycle, commitments, shadow, purchase] =
    await Promise.all([
      loadProductMasterCanonicalSalesAudit(),
      loadProductPlanningSnapshot(),
      loadProvisionalInventoryDiagnostics(),
      loadInventoryLifecycleSnapshot(),
      openChinaOrderCommitmentsByBarcode(),
      loadCanonicalPurchaseShadow(),
      loadInternalChinaMonthlyPurchaseSummary(cycle.cycleMonth).catch(
        () => null,
      ),
    ]);

  if (!audit.ready || !audit.snapshot) {
    blockers.push(
      audit.message || "Product Master canonical 판매원장이 준비되지 않았습니다.",
    );
  }
  if (!planning.products.length) {
    blockers.push("활성 Product Master planning 상품을 읽지 못했습니다.");
  }
  if (commitments.error) {
    blockers.push(`중국 미입고 원장 조회 실패: ${commitments.error}`);
  }
  if (!shadow.shadowReady || !shadow.snapshot) {
    blockers.push(
      ...shadow.blockers
        .filter((row) => row.key !== "claim-auxiliary")
        .map((row) => row.message),
    );
  }

  const purchaseBudgetMonthRevenueKrw = quantity(
    shadow.purchaseBudgetMonthRevenue,
  );
  const maxGrossBudgetKrw = Math.round(
    purchaseBudgetMonthRevenueKrw / 2,
  );
  const recorded1688SpendKrw = quantity(
    purchase?.actualOrderPaidKrwAtInternalFx,
  );
  const maxAdditionalGrossBudgetKrw = Math.max(
    0,
    maxGrossBudgetKrw - recorded1688SpendKrw,
  );
  const effectiveCashKrw = Math.min(
    requestedCashKrw ?? maxAdditionalGrossBudgetKrw,
    maxAdditionalGrossBudgetKrw,
  );
  const cashClamped =
    requestedCashKrw !== null && requestedCashKrw !== effectiveCashKrw;

  if (maxGrossBudgetKrw <= 0) {
    blockers.push("직전 달력월 정상매출 기준 전체 발주예산이 0원입니다.");
  }
  if (effectiveCashKrw <= 0) {
    blockers.push("현재 추가 발주에 투입 가능한 현금 한도가 없습니다.");
  }
  if (blockers.length || !audit.snapshot) {
    return blockedReport({
      generatedAt,
      cycleMonth: cycle.cycleMonth,
      budgetMonth: cycle.budgetMonth,
      budgetRevenue: purchaseBudgetMonthRevenueKrw,
      maxGrossBudget: maxGrossBudgetKrw,
      recordedSpend: recorded1688SpendKrw,
      requestedCash: requestedCashKrw,
      blockers: [...new Set(blockers)],
    });
  }

  const planningByBarcode = new Map(
    planning.products
      .filter((row) => row.skuActive !== false)
      .map((row) => [barcode(row.barcode), row] as const),
  );
  const diagnosticByBarcode = new Map(
    diagnostics.rows.map((row) => [barcode(row.barcode), row] as const),
  );
  const lifecycleByBarcode = new Map(
    lifecycle.rows.map((row) => [barcode(row.barcode), row] as const),
  );
  const modelNoByBarcode = new Map<string, string | null>();
  const unitCostByBarcode = new Map<string, number>();
  const products = audit.snapshot.rows
    .map((canonical) => {
      const key = barcode(canonical.barcode);
      const profile = planningByBarcode.get(key);
      if (!key || !profile) return null;
      const units = Array.isArray(canonical.monthlyUnits)
        ? canonical.monthlyUnits.map(quantity)
        : [];
      const revenue = Array.isArray(canonical.monthlyRevenue)
        ? canonical.monthlyRevenue.map(quantity)
        : [];
      const recentUnits = units.slice(0, 3).reduce((sum, value) => sum + value, 0);
      const recentRevenue = revenue
        .slice(0, 3)
        .reduce((sum, value) => sum + value, 0);
      const storedCost =
        decimal(profile.latestCostKrw) || decimal(profile.protectedCostKrw);
      const unitCost =
        storedCost > 0
          ? storedCost
          : recentUnits > 0
            ? Math.round((recentRevenue / recentUnits) * 0.5)
            : 0;
      if (unitCost <= 0) return null;
      const lifecycleRow = lifecycleByBarcode.get(key);
      const diagnostic = diagnosticByBarcode.get(key);
      const productMasterExact = Boolean(
        profile.inventoryConfirmed && !profile.inventoryRequiresReview,
      );
      const lifecycleExact = Boolean(
        lifecycleRow?.exactInventoryKnown &&
          lifecycleRow.exactInventoryQuantity !== null,
      );
      const exactInventoryKnown = lifecycleExact || productMasterExact;
      const exactInventoryQuantity = lifecycleExact
        ? lifecycleRow?.exactInventoryQuantity ?? 0
        : productMasterExact
          ? quantity(profile.inventoryQuantity)
          : null;
      const inventoryLowQuantity = exactInventoryKnown
        ? exactInventoryQuantity
        : diagnostic?.state === "BAND_READY"
          ? diagnostic.diagnosticLowQuantity
          : diagnostic?.cumulativeResidualCandidate ?? null;
      const inventoryHighQuantity = exactInventoryKnown
        ? exactInventoryQuantity
        : diagnostic?.state === "BAND_READY"
          ? diagnostic.diagnosticHighQuantity
          : diagnostic?.cumulativeResidualCandidate ?? null;
      modelNoByBarcode.set(key, text(profile.modelNo) || null);
      unitCostByBarcode.set(key, Math.round(unitCost));
      return calculatePurchaseV2Product({
        barcode: key,
        name: text(profile.productName) || key,
        monthlyUnits: units,
        monthlyRevenue: revenue,
        unitCost,
        openCommitment: quantity(commitments.commitments.get(key)),
        exactInventoryKnown,
        exactInventoryQuantity,
        inventoryLowQuantity,
        inventoryHighQuantity,
        availableDaysByBucket: lifecycleRow?.availableDaysByBucket,
        feedbackMultiplier: 1,
      });
    })
    .filter(
      (row): row is NonNullable<typeof row> => Boolean(row),
    );

  if (!products.length) {
    return blockedReport({
      generatedAt,
      cycleMonth: cycle.cycleMonth,
      budgetMonth: cycle.budgetMonth,
      budgetRevenue: purchaseBudgetMonthRevenueKrw,
      maxGrossBudget: maxGrossBudgetKrw,
      recordedSpend: recorded1688SpendKrw,
      requestedCash: requestedCashKrw,
      blockers: ["원가·판매·상품정체성이 모두 연결된 V2 계산대상이 없습니다."],
    });
  }

  const allocation = allocatePurchaseV2Portfolio({
    grossCashBudgetKrw: effectiveCashKrw,
    purchaseCostMultiplier: 1.45,
    items: products,
  });
  const rows = allocation.items.map((item) =>
    rowFromAllocated(
      item,
      modelNoByBarcode.get(item.barcode) ?? null,
      unitCostByBarcode.get(item.barcode) ?? 0,
    ),
  );
  const patternCounts = emptyPatternCounts();
  const groupCounts = emptyGroupCounts();
  for (const row of rows) {
    patternCounts[row.pattern] += 1;
    groupCounts[row.group] += 1;
  }
  const stable = rows.map((row) => ({
    barcode: row.barcode,
    pattern: row.pattern,
    group: row.group,
    targetDemand44Days: row.targetDemand44Days,
    exactInventoryKnown: row.exactInventoryKnown,
    inventoryLowQuantity: row.inventoryLowQuantity,
    inventoryHighQuantity: row.inventoryHighQuantity,
    openCommitment: row.openCommitment,
    preBudgetRecommendedQuantity: row.preBudgetRecommendedQuantity,
    cashAllocatedQuantity: row.cashAllocatedQuantity,
    priceSignal: row.priceSignal,
    priorityScore: row.priorityScore,
  }));

  return {
    generatedAt,
    state: "READY",
    ruleVersion: PURCHASE_V2_RULE_VERSION,
    cycleMonth: cycle.cycleMonth,
    budgetMonth: cycle.budgetMonth,
    purchaseBudgetMonthRevenueKrw,
    maxGrossBudgetKrw,
    recorded1688SpendKrw,
    maxAdditionalGrossBudgetKrw,
    requestedCashKrw,
    effectiveCashKrw,
    cashClamped,
    purchaseCostMultiplier: allocation.purchaseCostMultiplier,
    productOrderBudgetKrw: allocation.productOrderBudgetKrw,
    expectedProductSpendKrw: allocation.expectedProductSpendKrw,
    expectedAllInSpendKrw: allocation.expectedAllInSpendKrw,
    remainingCashKrw: allocation.remainingGrossCashKrw,
    evaluatedSkuCount: rows.length,
    recommendedSkuCount: allocation.recommendedSkuCount,
    manualReviewSkuCount: rows.filter(
      (row) => row.group === "수동 검토",
    ).length,
    budgetReducedSkuCount: allocation.budgetReducedSkuCount,
    patternCounts,
    groupCounts,
    rows,
    blockers: lifecycle.blockers,
    fingerprint: sha256({
      ruleVersion: PURCHASE_V2_RULE_VERSION,
      cycleMonth: cycle.cycleMonth,
      budgetMonth: cycle.budgetMonth,
      canonicalFingerprint: audit.snapshot.contentFingerprint,
      planningFingerprint: planning.contentFingerprint,
      lifecycleFingerprint: lifecycle.fingerprint,
      effectiveCashKrw,
      rows: stable,
    }),
  };
}

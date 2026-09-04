import { createHash } from "node:crypto";
import { openChinaOrderCommitmentsByBarcode } from "@/lib/chinaOrderLedger";
import { loadInternalChinaMonthlyPurchaseSummary } from "@/lib/internalChinaMonthlyPurchaseSummary";
import { loadInventoryTruthSnapshot } from "@/lib/inventoryTruthLedger";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import {
  calculateNetRequirement,
} from "@/lib/productDecisionEngine/netRequirement";
import {
  DEFAULT_PURCHASE_COST_MULTIPLIER,
  allocatePurchasePortfolio,
} from "@/lib/productDecisionEngine/portfolio";
import {
  calculateSalesOrderRecommendation,
  type SalesOrderGroup,
} from "@/lib/productDecisionEngine/salesOrder";
import { loadProductMasterCanonicalSalesAudit } from "@/lib/productMasterCanonicalSalesAudit";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadCanonicalPurchaseShadow } from "@/lib/stage8CanonicalPurchaseShadow";
import { loadProvisionalInventoryDiagnostics } from "@/lib/stage8ProvisionalInventoryDiagnostics";

const BARCODE_PATTERN = /^[A-Z]{3}\d+-\d+$/;
const ORDERABLE_GROUPS = new Set<SalesOrderGroup>([
  "발주 추천",
  "소량 검토",
]);

export type PurchaseV2InventoryBasis =
  | "STOCKOUT_RESET_EXACT"
  | "PRODUCT_MASTER_CONFIRMED"
  | "ESTIMATED_LOW_HIGH_BAND"
  | "UNKNOWN";

export type PurchaseV2RecommendationRow = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  optionName: string | null;
  pattern: string;
  priceEffect: string;
  priceChangeRate: number | null;
  trend: string;
  confidence: number;
  priorityScore: number;
  forecast30Units: number;
  targetCoverageDays: number;
  targetDemandQuantity: number;
  stockoutRecoveredUnits: number;
  inventoryBasis: PurchaseV2InventoryBasis;
  inventoryQuantity: number | null;
  inventoryLow: number | null;
  inventoryHigh: number | null;
  openCommitment: number;
  netRequiredQuantity: number;
  baselineGroup: SalesOrderGroup;
  finalGroup: SalesOrderGroup;
  allocatedQuantity: number;
  unitCostKrw: number;
  expectedProductCostKrw: number;
  budgetReduced: boolean;
  manualReview: boolean;
  exactSince: string | null;
  stockState: "SOLD_OUT" | "ON_SALE" | null;
  reasons: string[];
};

export type PurchaseV2RecommendationReport = {
  generatedAt: string;
  state: "READY" | "BLOCKED";
  message: string;
  cycleMonth: string;
  budgetMonth: string;
  ruleVersion: string;
  requestedCashKrw: number;
  effectiveCashKrw: number;
  maxGrossBudgetKrw: number;
  recorded1688SpendKrw: number;
  maxAdditionalGrossBudgetKrw: number;
  purchaseCostMultiplier: number;
  productOrderBudgetKrw: number;
  expectedProductSpendKrw: number;
  expectedAllInSpendKrw: number;
  remainingCashKrw: number;
  recommendedSkuCount: number;
  manualReviewSkuCount: number;
  exactInventorySkuCount: number;
  estimatedInventorySkuCount: number;
  rows: PurchaseV2RecommendationRow[];
  blockers: string[];
  fingerprint: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "");
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function decimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function percentileFactors(values: Map<string, number>) {
  const positive = [...values.values()]
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  const result = new Map<string, number>();
  for (const [key, value] of values) {
    if (value <= 0 || !positive.length) {
      result.set(key, 0);
      continue;
    }
    const below = positive.filter((candidate) => candidate < value).length;
    result.set(key, positive.length <= 1 ? 1 : below / (positive.length - 1));
  }
  return result;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function emptyReport(input: {
  message: string;
  cycleMonth: string;
  budgetMonth?: string;
  requestedCashKrw: number;
  maxGrossBudgetKrw?: number;
  recorded1688SpendKrw?: number;
  blockers?: string[];
}): PurchaseV2RecommendationReport {
  const maxGrossBudgetKrw = integer(input.maxGrossBudgetKrw);
  const recorded1688SpendKrw = integer(input.recorded1688SpendKrw);
  const maxAdditionalGrossBudgetKrw = Math.max(
    0,
    maxGrossBudgetKrw - recorded1688SpendKrw,
  );
  return {
    generatedAt: new Date().toISOString(),
    state: "BLOCKED",
    message: input.message,
    cycleMonth: input.cycleMonth,
    budgetMonth: input.budgetMonth ?? "",
    ruleVersion: "commerce-os-purchase-v2.0.0",
    requestedCashKrw: input.requestedCashKrw,
    effectiveCashKrw: 0,
    maxGrossBudgetKrw,
    recorded1688SpendKrw,
    maxAdditionalGrossBudgetKrw,
    purchaseCostMultiplier: DEFAULT_PURCHASE_COST_MULTIPLIER,
    productOrderBudgetKrw: 0,
    expectedProductSpendKrw: 0,
    expectedAllInSpendKrw: 0,
    remainingCashKrw: 0,
    recommendedSkuCount: 0,
    manualReviewSkuCount: 0,
    exactInventorySkuCount: 0,
    estimatedInventorySkuCount: 0,
    rows: [],
    blockers: input.blockers ?? [],
    fingerprint: sha256({ state: "BLOCKED", message: input.message }),
  };
}

export async function loadPurchaseV2Recommendation(
  cashInputKrw?: unknown,
): Promise<PurchaseV2RecommendationReport> {
  const generatedAt = new Date().toISOString();
  const cycleMonth = seoulCalendarMonth(new Date());
  const requestedCashKrw = integer(cashInputKrw);
  const [audit, planning, diagnostics, commitments, truth, budgetShadow, purchase] =
    await Promise.all([
      loadProductMasterCanonicalSalesAudit(),
      loadProductPlanningSnapshot(),
      loadProvisionalInventoryDiagnostics(),
      openChinaOrderCommitmentsByBarcode(),
      loadInventoryTruthSnapshot(),
      loadCanonicalPurchaseShadow(),
      loadInternalChinaMonthlyPurchaseSummary(cycleMonth).catch(() => null),
    ]);

  const maxGrossBudgetKrw = integer(
    budgetShadow.purchaseBudgetMonthRevenue / 2,
  );
  const recorded1688SpendKrw = integer(
    purchase?.actualOrderPaidKrwAtInternalFx,
  );
  const maxAdditionalGrossBudgetKrw = Math.max(
    0,
    maxGrossBudgetKrw - recorded1688SpendKrw,
  );
  const effectiveCashKrw = Math.min(
    requestedCashKrw > 0 ? requestedCashKrw : maxAdditionalGrossBudgetKrw,
    maxAdditionalGrossBudgetKrw,
  );

  const blockers: string[] = [];
  if (!audit.ready || !audit.snapshot) {
    blockers.push(audit.message || "Canonical 판매원장을 읽지 못했습니다.");
  }
  if (!planning.products.length) blockers.push("Product Master planning 입력이 없습니다.");
  if (commitments.error) blockers.push(`미입고 원장: ${commitments.error}`);
  if (truth.error) blockers.push(`정확재고 원장: ${truth.error}`);
  if (maxGrossBudgetKrw <= 0) blockers.push("월 전체 지출가능금액이 0원입니다.");
  if (effectiveCashKrw <= 0) blockers.push("추가 발주에 사용할 수 있는 현금이 없습니다.");
  if (blockers.length || !audit.snapshot) {
    return emptyReport({
      message: "V2 발주권장안의 필수 입력이 준비되지 않았습니다.",
      cycleMonth,
      budgetMonth: budgetShadow.purchaseBudgetMonth,
      requestedCashKrw,
      maxGrossBudgetKrw,
      recorded1688SpendKrw,
      blockers,
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
  const canonicalRows = audit.snapshot.rows.filter((row) => {
    const key = barcode(row.barcode);
    return BARCODE_PATTERN.test(key) && planningByBarcode.has(key);
  });
  const quantity90 = new Map<string, number>();
  const revenue90 = new Map<string, number>();
  for (const row of canonicalRows) {
    const key = barcode(row.barcode);
    quantity90.set(key, sum((row.monthlyUnits ?? []).slice(0, 3).map(integer)));
    revenue90.set(key, sum((row.monthlyRevenue ?? []).slice(0, 3).map(integer)));
  }
  const quantityFactors = percentileFactors(quantity90);
  const revenueFactors = percentileFactors(revenue90);

  const unallocated = canonicalRows.map((canonical) => {
    const key = barcode(canonical.barcode);
    const profile = planningByBarcode.get(key)!;
    const truthPosition = truth.byBarcode.get(key);
    const diagnostic = diagnosticByBarcode.get(key);
    const monthlyUnits = Array.from({ length: 12 }, (_, index) =>
      integer(canonical.monthlyUnits?.[index]),
    );
    const monthlyRevenue = Array.from({ length: 12 }, (_, index) =>
      integer(canonical.monthlyRevenue?.[index]),
    );
    const recentUnits = sum(monthlyUnits.slice(0, 3));
    const recentRevenue = sum(monthlyRevenue.slice(0, 3));
    const storedCost = integer(profile.latestCostKrw || profile.protectedCostKrw);
    const unitCostKrw =
      storedCost > 0
        ? storedCost
        : recentUnits > 0
          ? Math.round((recentRevenue / recentUnits) * 0.5)
          : 0;
    const sales = calculateSalesOrderRecommendation({
      monthlyUnits,
      monthlyRevenue,
      unitCost: unitCostKrw,
      weightedClaimRate: 0,
      salesPowerFactor:
        ((quantityFactors.get(key) ?? 0) + (revenueFactors.get(key) ?? 0)) / 2,
      stockoutDays: truthPosition?.stockoutDays,
      targetCoverageDays: 44,
    });
    const openCommitment = integer(commitments.commitments.get(key));

    let inventoryBasis: PurchaseV2InventoryBasis = "UNKNOWN";
    let inventoryQuantity: number | null = null;
    let inventoryLow: number | null = null;
    let inventoryHigh: number | null = null;
    let netRequiredQuantity = 0;
    let manualReview = false;
    let baselineGroup = sales.group;

    if (truthPosition?.exact && truthPosition.quantity !== null) {
      inventoryBasis = "STOCKOUT_RESET_EXACT";
      inventoryQuantity = integer(truthPosition.quantity);
      netRequiredQuantity = calculateNetRequirement({
        demandTarget: sales.rawRecommendedQuantity,
        originalGroup: sales.group,
        inventoryKnown: true,
        availableQuantity: inventoryQuantity,
        ledgerCommitment: openCommitment,
      }).recommendedQuantity;
    } else if (
      profile.inventoryConfirmed &&
      !profile.inventoryRequiresReview
    ) {
      inventoryBasis = "PRODUCT_MASTER_CONFIRMED";
      inventoryQuantity = integer(profile.inventoryQuantity);
      netRequiredQuantity = calculateNetRequirement({
        demandTarget: sales.rawRecommendedQuantity,
        originalGroup: sales.group,
        inventoryKnown: true,
        availableQuantity: inventoryQuantity,
        ledgerCommitment: openCommitment,
      }).recommendedQuantity;
    } else if (
      diagnostic?.state === "BAND_READY" &&
      diagnostic.diagnosticLowQuantity !== null &&
      diagnostic.diagnosticHighQuantity !== null
    ) {
      inventoryBasis = "ESTIMATED_LOW_HIGH_BAND";
      inventoryLow = integer(diagnostic.diagnosticLowQuantity);
      inventoryHigh = integer(diagnostic.diagnosticHighQuantity);
      const low = calculateNetRequirement({
        demandTarget: sales.rawRecommendedQuantity,
        originalGroup: sales.group,
        inventoryKnown: true,
        availableQuantity: inventoryLow,
        ledgerCommitment: openCommitment,
      }).recommendedQuantity;
      const high = calculateNetRequirement({
        demandTarget: sales.rawRecommendedQuantity,
        originalGroup: sales.group,
        inventoryKnown: true,
        availableQuantity: inventoryHigh,
        ledgerCommitment: openCommitment,
      }).recommendedQuantity;
      if (low > 0 && high > 0) {
        netRequiredQuantity = Math.min(low, high);
      } else if (low <= 0 && high <= 0) {
        netRequiredQuantity = 0;
        baselineGroup = "발주 보류";
      } else {
        netRequiredQuantity = 0;
        manualReview = true;
        baselineGroup = "소량 검토";
      }
    } else {
      inventoryBasis = "UNKNOWN";
      manualReview = true;
      baselineGroup = "데이터 부족";
    }

    if (!ORDERABLE_GROUPS.has(baselineGroup)) netRequiredQuantity = 0;
    const urgency = sales.rawRecommendedQuantity > 0
      ? Math.min(1, netRequiredQuantity / sales.rawRecommendedQuantity)
      : 0;
    const priorityScore = Math.round(
      sales.priorityScore + urgency * 20 +
        (inventoryBasis === "STOCKOUT_RESET_EXACT" ? 5 : 0),
    );

    return {
      key,
      profile,
      truthPosition,
      sales,
      unitCostKrw,
      openCommitment,
      inventoryBasis,
      inventoryQuantity,
      inventoryLow,
      inventoryHigh,
      netRequiredQuantity,
      manualReview,
      baselineGroup,
      priorityScore,
    };
  });

  const allocation = allocatePurchasePortfolio({
    recent30DayRevenue: budgetShadow.purchaseBudgetMonthRevenue,
    grossBudgetOverrideKrw: effectiveCashKrw,
    purchaseCostMultiplier: DEFAULT_PURCHASE_COST_MULTIPLIER,
    items: unallocated.map((row) => ({
      barcode: row.key,
      group: row.baselineGroup,
      netRequiredQuantity: row.netRequiredQuantity,
      unitCost: row.unitCostKrw,
      totalScore: row.priorityScore,
    })),
  });
  const allocationByBarcode = new Map(
    allocation.items.map((item) => [item.barcode, item] as const),
  );

  const rows: PurchaseV2RecommendationRow[] = unallocated
    .map((row) => {
      const allocated = allocationByBarcode.get(row.key)!;
      const reasons = [...row.sales.reasons];
      if (row.inventoryBasis === "STOCKOUT_RESET_EXACT") {
        reasons.push(
          `품절 초기화 이후 입고-판매 정확재고 ${integer(row.inventoryQuantity)}개를 사용했습니다.`,
        );
      } else if (row.inventoryBasis === "ESTIMATED_LOW_HIGH_BAND") {
        reasons.push(
          `추정재고 ${row.inventoryLow}~${row.inventoryHigh}개 양쪽에서 안전한 수량만 사용했습니다.`,
        );
      } else if (row.inventoryBasis === "UNKNOWN") {
        reasons.push("재고 증거가 없어 자동 발주에서 제외하고 품절확인 대상으로 보냈습니다.");
      }
      if (row.openCommitment > 0) {
        reasons.push(`이미 주문한 미입고 ${row.openCommitment}개를 차감했습니다.`);
      }
      return {
        barcode: row.key,
        modelNo: text(row.profile.modelNo) || null,
        productName: text(row.profile.productName) || row.key,
        optionName: text(row.profile.optionName) || null,
        pattern: row.sales.pattern,
        priceEffect: row.sales.priceEffect,
        priceChangeRate: row.sales.priceChangeRate,
        trend: row.sales.trendLabel,
        confidence: row.sales.confidence,
        priorityScore: row.priorityScore,
        forecast30Units: row.sales.forecastUnits,
        targetCoverageDays: row.sales.targetCoverageDays,
        targetDemandQuantity: row.sales.rawRecommendedQuantity,
        stockoutRecoveredUnits: row.sales.stockoutRecoveredUnits,
        inventoryBasis: row.inventoryBasis,
        inventoryQuantity: row.inventoryQuantity,
        inventoryLow: row.inventoryLow,
        inventoryHigh: row.inventoryHigh,
        openCommitment: row.openCommitment,
        netRequiredQuantity: row.netRequiredQuantity,
        baselineGroup: row.baselineGroup,
        finalGroup: allocated.finalGroup,
        allocatedQuantity: allocated.allocatedQuantity,
        unitCostKrw: integer(row.unitCostKrw),
        expectedProductCostKrw: integer(allocated.expectedCost),
        budgetReduced: allocated.budgetReduced,
        manualReview: row.manualReview,
        exactSince: row.truthPosition?.exactSince ?? null,
        stockState: row.truthPosition?.targetState ?? null,
        reasons: reasons.slice(0, 6),
      };
    })
    .sort((left, right) => {
      const allocated = Number(right.allocatedQuantity > 0) - Number(left.allocatedQuantity > 0);
      if (allocated !== 0) return allocated;
      return right.priorityScore - left.priorityScore || left.barcode.localeCompare(right.barcode, "ko");
    });

  const expectedProductSpendKrw = integer(allocation.expectedSpend);
  const expectedAllInSpendKrw = Math.min(
    effectiveCashKrw,
    integer(expectedProductSpendKrw * allocation.purchaseCostMultiplier),
  );
  const remainingCashKrw = Math.max(0, effectiveCashKrw - expectedAllInSpendKrw);
  const stableRows = rows.map((row) => ({
    barcode: row.barcode,
    pattern: row.pattern,
    targetDemandQuantity: row.targetDemandQuantity,
    inventoryBasis: row.inventoryBasis,
    inventoryQuantity: row.inventoryQuantity,
    inventoryLow: row.inventoryLow,
    inventoryHigh: row.inventoryHigh,
    openCommitment: row.openCommitment,
    netRequiredQuantity: row.netRequiredQuantity,
    allocatedQuantity: row.allocatedQuantity,
    unitCostKrw: row.unitCostKrw,
  }));

  return {
    generatedAt,
    state: "READY",
    message:
      "품절수요 복원·가격변동·성장형/안정형 분류·44일 목표수요·추정/정확재고·미입고·현금제약을 결합했습니다. MOQ와 박스입수는 수량 계산에서 제외했습니다.",
    cycleMonth,
    budgetMonth: budgetShadow.purchaseBudgetMonth,
    ruleVersion: "commerce-os-purchase-v2.0.0",
    requestedCashKrw,
    effectiveCashKrw,
    maxGrossBudgetKrw,
    recorded1688SpendKrw,
    maxAdditionalGrossBudgetKrw,
    purchaseCostMultiplier: allocation.purchaseCostMultiplier,
    productOrderBudgetKrw: allocation.productOrderBudget,
    expectedProductSpendKrw,
    expectedAllInSpendKrw,
    remainingCashKrw,
    recommendedSkuCount: rows.filter((row) => row.allocatedQuantity > 0).length,
    manualReviewSkuCount: rows.filter((row) => row.manualReview).length,
    exactInventorySkuCount: rows.filter(
      (row) => row.inventoryBasis === "STOCKOUT_RESET_EXACT",
    ).length,
    estimatedInventorySkuCount: rows.filter(
      (row) => row.inventoryBasis === "ESTIMATED_LOW_HIGH_BAND",
    ).length,
    rows,
    blockers: [],
    fingerprint: sha256({
      generatedFor: cycleMonth,
      effectiveCashKrw,
      budgetMonth: budgetShadow.purchaseBudgetMonth,
      salesFingerprint: audit.snapshot.contentFingerprint,
      inventoryFingerprint: truth.fingerprint,
      rows: stableRows,
    }),
  };
}

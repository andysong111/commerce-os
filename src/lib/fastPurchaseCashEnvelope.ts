import { loadInternalChinaMonthlyPurchaseSummary } from "@/lib/internalChinaMonthlyPurchaseSummary";
import {
  DEFAULT_PURCHASE_COST_MULTIPLIER,
  allocatePurchasePortfolio,
} from "@/lib/productDecisionEngine/portfolio";
import type { SalesOrderGroup } from "@/lib/productDecisionEngine/salesOrder";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import { loadCanonicalPurchaseShadow } from "@/lib/stage8CanonicalPurchaseShadow";

const MAX_CASH_INPUT_KRW = 100_000_000;
const ORDERABLE_GROUPS = new Set<SalesOrderGroup>([
  "발주 추천",
  "소량 검토",
]);

export type FastPurchaseCashEnvelopeRow = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  originalGroup: SalesOrderGroup;
  finalGroup: SalesOrderGroup;
  priorityScore: number;
  baselineQuantity: number;
  allocatedQuantity: number;
  minimumOrderQuantity: number;
  unitCostKrw: number;
  expectedProductCostKrw: number;
  budgetReduced: boolean;
};

export type FastPurchaseCashEnvelopeReport = {
  generatedAt: string;
  state: "READY" | "BLOCKED";
  message: string;
  cycleMonth: string;
  budgetMonth: string;
  requestedCashKrw: number;
  maxGrossBudgetKrw: number;
  recorded1688SpendKrw: number;
  maxAdditionalGrossBudgetKrw: number;
  effectiveCashKrw: number;
  cashClamped: boolean;
  purchaseCostMultiplier: number;
  productOrderBudgetKrw: number;
  expectedProductSpendKrw: number;
  expectedAllInSpendKrw: number;
  remainingCashKrw: number;
  recommendedSkuCount: number;
  budgetReducedSkuCount: number;
  rows: FastPurchaseCashEnvelopeRow[];
  blockers: string[];
};

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeGroup(value: unknown): SalesOrderGroup {
  const candidate = text(value);
  if (
    candidate === "발주 추천" ||
    candidate === "소량 검토" ||
    candidate === "발주 보류" ||
    candidate === "데이터 부족"
  ) {
    return candidate;
  }
  return "발주 보류";
}

function blockedReport(input: {
  message: string;
  cycleMonth: string;
  budgetMonth: string;
  requestedCashKrw: number;
  maxGrossBudgetKrw?: number;
  recorded1688SpendKrw?: number;
  blockers?: string[];
}): FastPurchaseCashEnvelopeReport {
  const maxGrossBudgetKrw = money(input.maxGrossBudgetKrw);
  const recorded1688SpendKrw = money(input.recorded1688SpendKrw);
  const maxAdditionalGrossBudgetKrw = Math.max(
    0,
    maxGrossBudgetKrw - recorded1688SpendKrw,
  );
  return {
    generatedAt: new Date().toISOString(),
    state: "BLOCKED",
    message: input.message,
    cycleMonth: input.cycleMonth,
    budgetMonth: input.budgetMonth,
    requestedCashKrw: input.requestedCashKrw,
    maxGrossBudgetKrw,
    recorded1688SpendKrw,
    maxAdditionalGrossBudgetKrw,
    effectiveCashKrw: 0,
    cashClamped: input.requestedCashKrw > maxAdditionalGrossBudgetKrw,
    purchaseCostMultiplier: DEFAULT_PURCHASE_COST_MULTIPLIER,
    productOrderBudgetKrw: 0,
    expectedProductSpendKrw: 0,
    expectedAllInSpendKrw: 0,
    remainingCashKrw: 0,
    recommendedSkuCount: 0,
    budgetReducedSkuCount: 0,
    rows: [],
    blockers: input.blockers ?? [],
  };
}

export async function loadFastPurchaseCashEnvelope(
  cashInputKrw: unknown,
): Promise<FastPurchaseCashEnvelopeReport> {
  const requestedCashKrw = money(cashInputKrw);
  if (requestedCashKrw <= 0 || requestedCashKrw > MAX_CASH_INPUT_KRW) {
    throw new Error("FAST_PURCHASE_CASH_ENVELOPE_AMOUNT_INVALID");
  }

  const cycleMonth = seoulCalendarMonth(new Date());
  const [shadow, planning, purchase] = await Promise.all([
    loadCanonicalPurchaseShadow(),
    loadProductPlanningSnapshot(),
    loadInternalChinaMonthlyPurchaseSummary(cycleMonth).catch(() => null),
  ]);

  const maxGrossBudgetKrw = money(shadow.purchaseBudgetMonthRevenue / 2);
  const recorded1688SpendKrw = money(
    purchase?.actualOrderPaidKrwAtInternalFx,
  );
  const maxAdditionalGrossBudgetKrw = Math.max(
    0,
    maxGrossBudgetKrw - recorded1688SpendKrw,
  );
  const effectiveCashKrw = Math.min(
    requestedCashKrw,
    maxAdditionalGrossBudgetKrw,
  );
  const cashClamped = requestedCashKrw !== effectiveCashKrw;

  if (!shadow.shadowReady || !shadow.snapshot) {
    return blockedReport({
      message:
        "현재 canonical 발주안의 구조 검증이 끝나지 않아 현금 제약 권장안을 만들지 않았습니다.",
      cycleMonth,
      budgetMonth: shadow.purchaseBudgetMonth,
      requestedCashKrw,
      maxGrossBudgetKrw,
      recorded1688SpendKrw,
      blockers: shadow.blockers.map((row) => row.message),
    });
  }
  if (maxGrossBudgetKrw <= 0) {
    return blockedReport({
      message: "이번 발주월의 전체 지출가능금액을 확정하지 못했습니다.",
      cycleMonth,
      budgetMonth: shadow.purchaseBudgetMonth,
      requestedCashKrw,
      maxGrossBudgetKrw,
      recorded1688SpendKrw,
    });
  }
  if (effectiveCashKrw <= 0) {
    return blockedReport({
      message:
        "이미 기록된 1688 결제액이 현재 전체 지출가능금액을 사용해 신규 발주에 배정할 한도가 없습니다.",
      cycleMonth,
      budgetMonth: shadow.purchaseBudgetMonth,
      requestedCashKrw,
      maxGrossBudgetKrw,
      recorded1688SpendKrw,
    });
  }

  const planningByBarcode = new Map(
    planning.products
      .filter((row) => row.skuActive !== false)
      .map((row) => [text(row.barcode).toUpperCase(), row] as const),
  );
  const baselineProducts = (shadow.snapshot.products ?? []).filter((row) => {
    const group = normalizeGroup(row.status);
    return (
      ORDERABLE_GROUPS.has(group) &&
      money(row.recommendedQty) > 0 &&
      Number(row.expectedCost ?? 0) > 0
    );
  });

  if (!baselineProducts.length) {
    return blockedReport({
      message: "현재 기존 발주엔진에서 추가 발주 대상으로 남아 있는 SKU가 없습니다.",
      cycleMonth,
      budgetMonth: shadow.purchaseBudgetMonth,
      requestedCashKrw,
      maxGrossBudgetKrw,
      recorded1688SpendKrw,
    });
  }

  const sourceByBarcode = new Map(
    baselineProducts.map((row) => [text(row.barcode).toUpperCase(), row] as const),
  );
  const allocation = allocatePurchasePortfolio({
    recent30DayRevenue: shadow.purchaseBudgetMonthRevenue,
    grossBudgetOverrideKrw: effectiveCashKrw,
    purchaseCostMultiplier: DEFAULT_PURCHASE_COST_MULTIPLIER,
    items: baselineProducts.map((row) => {
      const barcode = text(row.barcode).toUpperCase();
      const baselineQuantity = money(row.recommendedQty);
      const expectedCost = Math.max(0, Number(row.expectedCost ?? 0));
      const planningRow = planningByBarcode.get(barcode);
      return {
        barcode,
        group: normalizeGroup(row.status),
        netRequiredQuantity: baselineQuantity,
        unitCost:
          baselineQuantity > 0 && expectedCost > 0
            ? expectedCost / baselineQuantity
            : Math.max(0, Number(planningRow?.latestCostKrw ?? 0)),
        totalScore: Math.max(0, Number(row.score?.total ?? 0)),
        moq: Math.max(1, money(planningRow?.moq) || 1),
        cartonQuantity: Math.max(
          1,
          money(planningRow?.cartonQuantity) || 1,
        ),
      };
    }),
  });

  const rows: FastPurchaseCashEnvelopeRow[] = allocation.items
    .map((item) => {
      const source = sourceByBarcode.get(item.barcode);
      return {
        barcode: item.barcode,
        modelNo: source?.modelNo ?? null,
        productName: text(source?.name) || item.barcode,
        originalGroup: item.group,
        finalGroup: item.finalGroup,
        priorityScore: Math.round(item.totalScore * 100) / 100,
        baselineQuantity: item.targetQuantity,
        allocatedQuantity: item.allocatedQuantity,
        minimumOrderQuantity: item.minimumOrderQuantity,
        unitCostKrw: money(item.unitCost),
        expectedProductCostKrw: money(item.expectedCost),
        budgetReduced: item.budgetReduced,
      };
    })
    .sort((left, right) => {
      const allocated = Number(right.allocatedQuantity > 0) - Number(left.allocatedQuantity > 0);
      if (allocated !== 0) return allocated;
      const group =
        Number(left.finalGroup === "소량 검토") -
        Number(right.finalGroup === "소량 검토");
      if (group !== 0) return group;
      return (
        right.priorityScore - left.priorityScore ||
        left.barcode.localeCompare(right.barcode, "ko")
      );
    });

  const expectedProductSpendKrw = money(allocation.expectedSpend);
  const expectedAllInSpendKrw = Math.min(
    effectiveCashKrw,
    money(expectedProductSpendKrw * allocation.purchaseCostMultiplier),
  );
  const remainingCashKrw = Math.max(
    0,
    effectiveCashKrw - expectedAllInSpendKrw,
  );
  const recommendedSkuCount = rows.filter(
    (row) => row.allocatedQuantity > 0 && ORDERABLE_GROUPS.has(row.finalGroup),
  ).length;
  const budgetReducedSkuCount = rows.filter((row) => row.budgetReduced).length;

  return {
    generatedAt: new Date().toISOString(),
    state: "READY",
    message: cashClamped
      ? "입력 현금이 현재 추가 지출가능한도를 넘어 한도까지만 적용했습니다. 기존 발주 우선순위·MOQ·박스입수·최소주문금액 규칙은 그대로 유지합니다."
      : "입력한 현금 안에서 기존 발주 우선순위·MOQ·박스입수·최소주문금액 규칙을 그대로 적용했습니다.",
    cycleMonth,
    budgetMonth: shadow.purchaseBudgetMonth,
    requestedCashKrw,
    maxGrossBudgetKrw,
    recorded1688SpendKrw,
    maxAdditionalGrossBudgetKrw,
    effectiveCashKrw,
    cashClamped,
    purchaseCostMultiplier: allocation.purchaseCostMultiplier,
    productOrderBudgetKrw: allocation.productOrderBudget,
    expectedProductSpendKrw,
    expectedAllInSpendKrw,
    remainingCashKrw,
    recommendedSkuCount,
    budgetReducedSkuCount,
    rows,
    blockers: [],
  };
}

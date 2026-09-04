import type { SalesOrderGroup } from "./salesOrder.ts";

export const DEFAULT_PURCHASE_COST_MULTIPLIER = 1.45;
export const MIN_PURCHASE_COST_MULTIPLIER = 1;
export const MAX_PURCHASE_COST_MULTIPLIER = 3;
export const DEFAULT_MINIMUM_ORDER_AMOUNT = 5_000;

const ORDERABLE_GROUPS = new Set<SalesOrderGroup>([
  "발주 추천",
  "소량 검토",
]);

export type PortfolioItemInput = {
  barcode: string;
  group: SalesOrderGroup;
  netRequiredQuantity: number;
  unitCost: number;
  totalScore: number;
  /** 공급처 참고정보. V2 예산배분과 수량결정에는 사용하지 않습니다. */
  moq?: number;
  /** 공급처 참고정보. V2 예산배분과 수량결정에는 사용하지 않습니다. */
  cartonQuantity?: number;
};

export type PortfolioItemResult = PortfolioItemInput & {
  minimumOrderQuantity: number;
  targetQuantity: number;
  allocatedQuantity: number;
  finalGroup: SalesOrderGroup;
  expectedCost: number;
  minimumApplied: boolean;
  minimumReview: boolean;
  budgetReduced: boolean;
};

export type PortfolioAllocationInput = {
  recent30DayRevenue: number;
  grossBudgetOverrideKrw?: number;
  purchaseCostMultiplier?: number;
  minimumOrderAmount?: number;
  items: PortfolioItemInput[];
};

export type PortfolioAllocationResult = {
  grossBudget: number;
  purchaseCostMultiplier: number;
  productOrderBudget: number;
  remainingBudget: number;
  expectedSpend: number;
  groupCounts: Record<SalesOrderGroup, number>;
  items: PortfolioItemResult[];
};

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.ceil(parsed)) : 0;
}

function normalizeMultiplier(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_PURCHASE_COST_MULTIPLIER;
  return Math.min(
    MAX_PURCHASE_COST_MULTIPLIER,
    Math.max(MIN_PURCHASE_COST_MULTIPLIER, Math.round(parsed * 100) / 100),
  );
}

export function calculateProductOrderBudget(
  grossBudget: number,
  multiplier: number,
) {
  return Math.max(
    0,
    Math.floor(Math.max(0, grossBudget) / normalizeMultiplier(multiplier)),
  );
}

function groupRank(group: SalesOrderGroup) {
  if (group === "발주 추천") return 0;
  if (group === "소량 검토") return 1;
  return 2;
}

function emptyGroupCounts(): Record<SalesOrderGroup, number> {
  return {
    "발주 추천": 0,
    "소량 검토": 0,
    "발주 보류": 0,
    "데이터 부족": 0,
  };
}

/**
 * V2 현금 배분 규칙
 * 1) MOQ·박스입수로 필요수량을 올리거나 내리지 않는다.
 * 2) 5천원 기준은 강제 증량이 아니라 소액주문 검토표시로만 사용한다.
 * 3) 예산이 부족하면 상위 SKU 한두 개에 전액을 몰지 않고 35% → 70% → 100%
 *    세 라운드로 배정해 품절방지·안정상품·성장상품에 자금이 분산되게 한다.
 */
export function allocatePurchasePortfolio(
  input: PortfolioAllocationInput,
): PortfolioAllocationResult {
  const recent30DayRevenue = Math.max(
    0,
    Math.round(Number(input.recent30DayRevenue) || 0),
  );
  const override = Number(input.grossBudgetOverrideKrw);
  const grossBudget = Number.isFinite(override)
    ? Math.max(0, Math.round(override))
    : Math.round(recent30DayRevenue / 2);
  const purchaseCostMultiplier = normalizeMultiplier(
    input.purchaseCostMultiplier,
  );
  const productOrderBudget = calculateProductOrderBudget(
    grossBudget,
    purchaseCostMultiplier,
  );
  const minimumOrderAmount = Math.max(
    0,
    Math.round(
      Number(input.minimumOrderAmount ?? DEFAULT_MINIMUM_ORDER_AMOUNT) || 0,
    ),
  );

  const prepared: PortfolioItemResult[] = input.items.map((source) => {
    const netRequiredQuantity = quantity(source.netRequiredQuantity);
    const unitCost = Math.max(0, Number(source.unitCost) || 0);
    const orderable =
      ORDERABLE_GROUPS.has(source.group) &&
      netRequiredQuantity > 0 &&
      unitCost > 0;
    const targetQuantity = orderable ? netRequiredQuantity : 0;
    const targetCost = targetQuantity * unitCost;
    const minimumReview =
      orderable && minimumOrderAmount > 0 && targetCost < minimumOrderAmount;
    const finalGroup =
      minimumReview && source.group === "발주 추천"
        ? ("소량 검토" as const)
        : source.group;

    return {
      ...source,
      netRequiredQuantity,
      unitCost,
      moq: source.moq,
      cartonQuantity: source.cartonQuantity,
      minimumOrderQuantity: orderable ? 1 : 0,
      targetQuantity,
      allocatedQuantity: 0,
      finalGroup,
      expectedCost: 0,
      minimumApplied: false,
      minimumReview,
      budgetReduced: false,
    };
  });

  let remainingBudget = productOrderBudget;
  const candidates = prepared
    .filter(
      (entry) =>
        ORDERABLE_GROUPS.has(entry.finalGroup) &&
        entry.unitCost > 0 &&
        entry.targetQuantity > 0,
    )
    .sort((left, right) => {
      const group = groupRank(left.finalGroup) - groupRank(right.finalGroup);
      if (group !== 0) return group;
      return (
        right.totalScore - left.totalScore ||
        left.barcode.localeCompare(right.barcode, "ko")
      );
    });

  const allocateRound = (fraction: number) => {
    for (const entry of candidates) {
      if (remainingBudget < entry.unitCost) break;
      const roundTarget = Math.min(
        entry.targetQuantity,
        Math.max(1, Math.ceil(entry.targetQuantity * fraction)),
      );
      const missing = Math.max(0, roundTarget - entry.allocatedQuantity);
      if (missing <= 0) continue;
      const affordable = Math.floor(remainingBudget / entry.unitCost);
      const added = Math.min(missing, affordable);
      if (added <= 0) continue;
      entry.allocatedQuantity += added;
      remainingBudget = Math.max(
        0,
        remainingBudget - added * entry.unitCost,
      );
    }
  };

  allocateRound(0.35);
  allocateRound(0.7);
  allocateRound(1);

  const groupCounts = emptyGroupCounts();
  let expectedSpend = 0;
  for (const entry of prepared) {
    entry.budgetReduced = entry.allocatedQuantity < entry.targetQuantity;
    if (entry.targetQuantity > 0 && entry.allocatedQuantity <= 0) {
      entry.finalGroup = "발주 보류";
    }
    entry.expectedCost = entry.allocatedQuantity * entry.unitCost;
    groupCounts[entry.finalGroup] += 1;
    if (ORDERABLE_GROUPS.has(entry.finalGroup)) {
      expectedSpend += entry.expectedCost;
    }
  }

  return {
    grossBudget,
    purchaseCostMultiplier,
    productOrderBudget,
    remainingBudget,
    expectedSpend,
    groupCounts,
    items: prepared,
  };
}

export const INTERNAL_CHINA_COST_PRICE_RULE_VERSION =
  "commerce-os-cost-price-v1.0.0";

export type InternalChinaCostPriceDirection =
  | "INCREASE"
  | "DECREASE"
  | "HOLD"
  | "BLOCKED";

export type InternalChinaCostPriceDecision = {
  currentPrice: number;
  latestCostKrw: number;
  previousCostKrw: number | null;
  unitsPerOrder: number;
  costChangeRate: number | null;
  targetPrice: number;
  direction: InternalChinaCostPriceDirection;
  changeRequired: boolean;
  blockedReason: string | null;
  reason: string;
};

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function positiveInteger(value: unknown) {
  return Math.max(1, integer(value) || 1);
}

export function costDefensePrice(
  latestCostKrw: unknown,
  unitsPerOrder: unknown = 1,
) {
  const cost = integer(latestCostKrw);
  const units = positiveInteger(unitsPerOrder);
  return cost > 0 ? Math.ceil((cost * units * 2) / 10) * 10 : 0;
}

export function buildInternalChinaCostPriceDecision(input: {
  currentPrice: number;
  latestCostKrw: number;
  previousCostKrw?: number | null;
  unitsPerOrder?: number | null;
}): InternalChinaCostPriceDecision {
  const currentPrice = integer(input.currentPrice);
  const latestCostKrw = integer(input.latestCostKrw);
  const previousCostKrw =
    input.previousCostKrw === null || input.previousCostKrw === undefined
      ? null
      : integer(input.previousCostKrw);
  const unitsPerOrder = positiveInteger(input.unitsPerOrder);
  const targetPrice = costDefensePrice(latestCostKrw, unitsPerOrder);
  const costChangeRate =
    previousCostKrw && previousCostKrw > 0
      ? Math.round((latestCostKrw / previousCostKrw - 1) * 10_000) / 10_000
      : null;

  if (currentPrice <= 0) {
    return {
      currentPrice,
      latestCostKrw,
      previousCostKrw,
      unitsPerOrder,
      costChangeRate,
      targetPrice,
      direction: "BLOCKED",
      changeRequired: false,
      blockedReason: "CURRENT_PRICE_MISSING",
      reason: "현재 Shopling 판매가를 확인하지 못해 가격조정안을 만들지 않았습니다.",
    };
  }
  if (latestCostKrw <= 0) {
    return {
      currentPrice,
      latestCostKrw,
      previousCostKrw,
      unitsPerOrder,
      costChangeRate,
      targetPrice,
      direction: "BLOCKED",
      changeRequired: false,
      blockedReason: "CONFIRMED_COST_MISSING",
      reason: "확정 매입원가가 없어 가격조정안을 만들지 않았습니다.",
    };
  }
  if (currentPrice < targetPrice) {
    return {
      currentPrice,
      latestCostKrw,
      previousCostKrw,
      unitsPerOrder,
      costChangeRate,
      targetPrice,
      direction: "INCREASE",
      changeRequired: true,
      blockedReason: null,
      reason: `현재 판매가가 최신 확정원가 × 주문당 ${unitsPerOrder}개 × 2인 ${targetPrice.toLocaleString("ko-KR")}원보다 낮아 원가 방어 인상안입니다.`,
    };
  }
  if (
    previousCostKrw !== null &&
    previousCostKrw > 0 &&
    latestCostKrw < previousCostKrw &&
    currentPrice > targetPrice
  ) {
    return {
      currentPrice,
      latestCostKrw,
      previousCostKrw,
      unitsPerOrder,
      costChangeRate,
      targetPrice,
      direction: "DECREASE",
      changeRequired: true,
      blockedReason: null,
      reason: `최신 확정원가가 직전 ${previousCostKrw.toLocaleString("ko-KR")}원에서 ${latestCostKrw.toLocaleString("ko-KR")}원으로 내려 새 원가 × 주문당 ${unitsPerOrder}개 × 2 기준까지 인하하는 안입니다.`,
    };
  }

  return {
    currentPrice,
    latestCostKrw,
    previousCostKrw,
    unitsPerOrder,
    costChangeRate,
    targetPrice,
    direction: "HOLD",
    changeRequired: false,
    blockedReason: null,
    reason:
      previousCostKrw === null
        ? "직전 확정원가가 없어 원가 인하 근거가 확인될 때까지 현재 판매가를 유지합니다."
        : "현재 판매가가 최신 확정원가 기준을 충족하고 원가 하락에 따른 인하 조건도 없어 유지합니다.",
  };
}

import {
  INTERNAL_PRICE_GROUP_MULTIPLIER,
  buildInternalMallPriceTargets,
  internalPriceGroupTarget,
  normalizeInternalPriceGroup,
  type InternalPriceGroup,
} from "@/lib/internalChinaPriceGroupPolicy";
import type { InternalChinaCostPriceDirection } from "@/lib/internalChinaCostPricePolicy";

export const INTERNAL_CHINA_GROUP_COST_PRICE_RULE_VERSION =
  "commerce-os-cost-price-group-v2.0.0";

export type InternalChinaGroupCostPriceDecision = {
  currentPrice: number;
  latestCostKrw: number;
  previousCostKrw: number | null;
  unitsPerOrder: number;
  productGroup: InternalPriceGroup | null;
  groupMultiplier: number | null;
  costChangeRate: number | null;
  targetPrice: number;
  mallTargets: ReturnType<typeof buildInternalMallPriceTargets>;
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

export function buildInternalChinaGroupCostPriceDecision(input: {
  currentPrice: number;
  latestCostKrw: number;
  previousCostKrw?: number | null;
  unitsPerOrder?: number | null;
  productGroup?: unknown;
}): InternalChinaGroupCostPriceDecision {
  const currentPrice = integer(input.currentPrice);
  const latestCostKrw = integer(input.latestCostKrw);
  const previousCostKrw =
    input.previousCostKrw === null || input.previousCostKrw === undefined
      ? null
      : integer(input.previousCostKrw);
  const unitsPerOrder = positiveInteger(input.unitsPerOrder);
  const productGroup = normalizeInternalPriceGroup(input.productGroup);
  const groupMultiplier = productGroup
    ? INTERNAL_PRICE_GROUP_MULTIPLIER[productGroup]
    : null;
  const targetPrice = productGroup
    ? internalPriceGroupTarget({ latestCostKrw, unitsPerOrder, productGroup })
    : 0;
  const mallTargets = productGroup
    ? buildInternalMallPriceTargets({ productGroup, groupTargetPrice: targetPrice })
    : [];
  const costChangeRate =
    previousCostKrw && previousCostKrw > 0
      ? Math.round((latestCostKrw / previousCostKrw - 1) * 10_000) / 10_000
      : null;
  const base = {
    currentPrice,
    latestCostKrw,
    previousCostKrw,
    unitsPerOrder,
    productGroup,
    groupMultiplier,
    costChangeRate,
    targetPrice,
    mallTargets,
  };

  if (currentPrice <= 0) {
    return {
      ...base,
      direction: "BLOCKED",
      changeRequired: false,
      blockedReason: "CURRENT_PRICE_MISSING",
      reason: "현재 Shopling 판매가를 확인하지 못해 가격조정안을 만들지 않았습니다.",
    };
  }
  if (latestCostKrw <= 0) {
    return {
      ...base,
      direction: "BLOCKED",
      changeRequired: false,
      blockedReason: "CONFIRMED_COST_MISSING",
      reason: "확정 매입원가가 없어 가격조정안을 만들지 않았습니다.",
    };
  }
  if (!productGroup || groupMultiplier === null || targetPrice <= 0) {
    return {
      ...base,
      direction: "BLOCKED",
      changeRequired: false,
      blockedReason: "PRODUCT_GROUP_NOT_RESOLVED",
      reason:
        "GOODSKEY의 OPS 내부 가격그룹(도매1~4/소매1~2)을 확정하지 못했습니다. 구형 상품은 1회 그룹파일 백필 후 재산출하며, 코드 형태로 추측하지 않습니다.",
    };
  }
  if (currentPrice < targetPrice) {
    return {
      ...base,
      direction: "INCREASE",
      changeRequired: true,
      blockedReason: null,
      reason: `현재 판매가가 확정원가 × 주문당 ${unitsPerOrder}개 × 2 × ${productGroup} 배수 ${groupMultiplier}인 ${targetPrice.toLocaleString("ko-KR")}원보다 낮아 원가 방어 인상안입니다.`,
    };
  }
  if (
    previousCostKrw !== null &&
    previousCostKrw > 0 &&
    latestCostKrw < previousCostKrw &&
    currentPrice > targetPrice
  ) {
    return {
      ...base,
      direction: "DECREASE",
      changeRequired: true,
      blockedReason: null,
      reason: `확정원가가 직전 ${previousCostKrw.toLocaleString("ko-KR")}원에서 ${latestCostKrw.toLocaleString("ko-KR")}원으로 내려 ${productGroup} 배수 ${groupMultiplier} 기준 ${targetPrice.toLocaleString("ko-KR")}원까지 인하하는 안입니다.`,
    };
  }

  return {
    ...base,
    direction: "HOLD",
    changeRequired: false,
    blockedReason: null,
    reason:
      previousCostKrw === null
        ? `첫 확정원가이므로 인하하지 않고 현재가가 ${productGroup} 기준가 ${targetPrice.toLocaleString("ko-KR")}원 이상이라 유지합니다.`
        : `현재가가 ${productGroup} 기준가 ${targetPrice.toLocaleString("ko-KR")}원을 충족하며 원가 하락 인하 조건도 없어 유지합니다.`,
  };
}

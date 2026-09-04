import {
  calculatePurchaseV2Demand,
  PURCHASE_V2_RULE_VERSION,
  type PurchaseV2Pattern,
  type PurchaseV2PriceEffect,
} from "./purchaseV2.ts";

export const SALES_ORDER_RULE_VERSION = PURCHASE_V2_RULE_VERSION;

export type SalesOrderGroup =
  | "발주 추천"
  | "소량 검토"
  | "발주 보류"
  | "데이터 부족";

export type SeasonState =
  | "시즌 진입"
  | "시즌 중"
  | "시즌 종료 임박"
  | "비시즌"
  | "계절성 불명확";

export interface SalesOrderInput {
  monthlyUnits: number[];
  monthlyRevenue: number[];
  unitCost: number;
  weightedClaimRate: number;
  salesPowerFactor: number;
  /** 공급처 참고정보로만 보존합니다. V2 발주수량 계산에는 사용하지 않습니다. */
  moq?: number;
  /** 공급처 참고정보로만 보존합니다. V2 발주수량 계산에는 사용하지 않습니다. */
  cartonQuantity?: number;
  stockoutDays?: number[];
  learningAdjustment?: number;
  targetCoverageDays?: number;
}

export interface SalesOrderResult {
  ruleVersion: string;
  group: SalesOrderGroup;
  priorityScore: number;
  forecastUnits: number;
  rawRecommendedQuantity: number;
  recommendedQuantity: number;
  oneMonthGrowthRate: number;
  twoMonthGrowthRate: number;
  recentThreeMonthAverage: number;
  activeSalesMonths: number;
  trendLabel: "급상승" | "상승" | "유지" | "하락" | "급하락";
  seasonState: SeasonState;
  confidence: number;
  reasons: string[];
  missingData: string[];
  pattern: PurchaseV2Pattern;
  priceEffect: PurchaseV2PriceEffect;
  priceChangeRate: number | null;
  stockoutRecoveredUnits: number;
  targetCoverageDays: number;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
  return values.length ? sum(values) / values.length : 0;
}

/**
 * V2에서는 MOQ와 박스입수로 수량을 올리지 않습니다.
 * 기존 호출부 호환을 위해 인자는 유지하지만 계산 결과는 실제 필요수량의 정수 올림입니다.
 */
export function roundOrderQuantity(
  quantity: number,
  _moq = 1,
  _cartonQuantity = 1,
) {
  const parsed = Number(quantity);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : 0;
}

function seasonState(units: number[]): SeasonState {
  const total = sum(units);
  const active = units.filter((value) => value > 0).length;
  if (total <= 0 || active < 6) return "계절성 불명확";
  const sorted = [...units].sort((left, right) => right - left);
  const concentration = sum(sorted.slice(0, 3)) / total;
  if (concentration < 0.55) return "계절성 불명확";
  const recent = units[0] ?? 0;
  const recentThree = average(units.slice(0, 3));
  const previousThree = average(units.slice(3, 6));
  const annualAverage = average(units);
  if (
    recentThree >= annualAverage * 1.35 &&
    recentThree >= previousThree * 1.15
  ) {
    return recent >= recentThree ? "시즌 중" : "시즌 진입";
  }
  if (
    previousThree >= annualAverage * 1.35 &&
    recentThree <= previousThree * 0.72
  ) {
    return "시즌 종료 임박";
  }
  if (recentThree <= annualAverage * 0.55) return "비시즌";
  return "계절성 불명확";
}

function trendLabel(oneMonth: number, twoMonth: number, sample: number) {
  if (sample < 10) return "유지" as const;
  if (oneMonth >= 30 && twoMonth >= 15) return "급상승" as const;
  if (oneMonth >= 10 || twoMonth >= 10) return "상승" as const;
  if (oneMonth <= -30 && twoMonth <= -15) return "급하락" as const;
  if (oneMonth <= -10 || twoMonth <= -10) return "하락" as const;
  return "유지" as const;
}

export function calculateSalesOrderRecommendation(
  input: SalesOrderInput,
): SalesOrderResult {
  const demand = calculatePurchaseV2Demand(input);
  const annualUnits = sum(demand.demandUnits);
  const recent60Units = sum(demand.demandUnits.slice(0, 2));
  const trend = trendLabel(
    demand.oneMonthGrowthRate,
    demand.twoMonthGrowthRate,
    recent60Units,
  );

  let group: SalesOrderGroup;
  if (annualUnits <= 0) group = "데이터 부족";
  else if (
    demand.targetDemandQuantity <= 0 ||
    demand.pattern === "휴면형" ||
    Number(input.weightedClaimRate) >= 20
  ) {
    group = "발주 보류";
  } else if (
    demand.activeSalesMonths < 3 ||
    recent60Units < 10 ||
    demand.confidence < 0.65
  ) {
    group = "소량 검토";
  } else {
    group = "발주 추천";
  }

  const missingData: string[] = [];
  if (annualUnits <= 0) missingData.push("판매 이력");
  if (Number(input.unitCost) <= 0) missingData.push("원가");

  return {
    ruleVersion: demand.ruleVersion,
    group,
    priorityScore: demand.priorityScore,
    forecastUnits: demand.forecast30Units,
    rawRecommendedQuantity: demand.targetDemandQuantity,
    recommendedQuantity: demand.targetDemandQuantity,
    oneMonthGrowthRate: demand.oneMonthGrowthRate,
    twoMonthGrowthRate: demand.twoMonthGrowthRate,
    recentThreeMonthAverage: demand.recentThreeMonthAverage,
    activeSalesMonths: demand.activeSalesMonths,
    trendLabel: trend,
    seasonState: seasonState(demand.demandUnits),
    confidence: demand.confidence,
    reasons: demand.reasons,
    missingData,
    pattern: demand.pattern,
    priceEffect: demand.priceEffect,
    priceChangeRate: demand.priceChangeRate,
    stockoutRecoveredUnits: demand.stockoutRecoveredUnits,
    targetCoverageDays: demand.targetCoverageDays,
  };
}

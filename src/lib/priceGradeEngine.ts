export const PRICE_GRADE_RULE_VERSION =
  "commerce-os-price-grade-v1.0.0";

export type ProductPriceGrade = -4 | -3 | -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type PriceSeasonState =
  | "시즌 진입"
  | "시즌 중"
  | "시즌 종료 임박"
  | "비시즌"
  | "계절성 불명확";
export type PriceGradeDecision =
  | "increase_required"
  | "decrease_review"
  | "discontinued_review"
  | "hold"
  | "blocked";

export type ReceiptCostInput = {
  receivedAt: string;
  unitCostKrw: number;
  quantity?: number;
};

export type ProductPriceGradeInput = {
  barcode: string;
  currentPrice: number;
  currentGrade?: number;
  launchedAt?: string | null;
  lastSaleAt?: string | null;
  monthlyUnits: number[];
  receipts: ReceiptCostInput[];
  discontinued?: boolean;
  active?: boolean;
  markdownStage?: 0 | 1;
  asOf?: string;
};

export type ProductPriceGradeResult = {
  ruleVersion: string;
  barcode: string;
  grade: ProductPriceGrade;
  previousGrade: ProductPriceGrade;
  decision: PriceGradeDecision;
  seasonState: PriceSeasonState;
  latestCost: number;
  protectionCost: number;
  marginFloorPrice: number;
  currentPrice: number;
  recommendedPrice: number;
  adjustmentRate: number;
  defaultSelected: boolean;
  declineSignals: string[];
  reasons: string[];
  blockedReasons: string[];
  evidence: {
    recent30: number;
    previous30: number;
    recent90: number;
    previous90: number;
    priorYear90: number;
    recent365: number;
    prior365: number;
    activeMonths: number;
    historyMonths: number;
    daysSinceLastSale: number | null;
    increaseEligible: boolean;
    declineSignalCount: number;
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]) {
  return values.length ? sum(values) / values.length : 0;
}

function safeUnits(values: number[]) {
  return Array.from({ length: 24 }, (_, index) =>
    Math.max(0, Number(values[index] ?? 0)),
  );
}

function clampGrade(value: unknown): ProductPriceGrade {
  const parsed = Math.round(Number(value));
  const grade = Number.isFinite(parsed) ? Math.max(-4, Math.min(6, parsed)) : 0;
  return grade as ProductPriceGrade;
}

function rateDecrease(current: number, previous: number) {
  if (previous <= 0) return 0;
  return (previous - current) / previous;
}

function validDate(value: unknown) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function ceilToTen(value: number) {
  return Math.max(0, Math.ceil(value / 10) * 10);
}

function percentagePrice(value: number, rate: number) {
  return ceilToTen(value * (1 + rate));
}

export function calculateProtectedReceiptCost(
  receipts: ReceiptCostInput[],
  asOf = new Date(),
) {
  const end = asOf.valueOf();
  const cutoff = end - 365 * DAY_MS;
  const valid = receipts
    .map((receipt) => ({
      receivedAt: validDate(receipt.receivedAt),
      unitCostKrw: Math.max(0, Math.round(Number(receipt.unitCostKrw) || 0)),
    }))
    .filter(
      (receipt): receipt is { receivedAt: number; unitCostKrw: number } =>
        receipt.receivedAt !== null &&
        receipt.receivedAt <= end &&
        receipt.receivedAt >= cutoff &&
        receipt.unitCostKrw > 0,
    )
    .sort((left, right) => right.receivedAt - left.receivedAt);

  const latestCost = valid[0]?.unitCostKrw ?? 0;
  const recentThree = valid.slice(0, 3);
  const protectionCost = recentThree.length
    ? Math.max(...recentThree.map((receipt) => receipt.unitCostKrw))
    : latestCost;
  return {
    latestCost,
    protectionCost,
    receiptCount365: valid.length,
    protectedReceiptCount: recentThree.length,
  };
}

export function detectPriceSeasonState(monthlyUnits: number[]): PriceSeasonState {
  const units = safeUnits(monthlyUnits).slice(0, 12);
  const total = sum(units);
  const active = units.filter((value) => value > 0).length;
  if (total <= 0 || active < 6) return "계절성 불명확";

  const sorted = [...units].sort((left, right) => right - left);
  const concentration = sum(sorted.slice(0, 3)) / total;
  if (concentration < 0.55) return "계절성 불명확";

  const recent = units[0];
  const recentThree = average(units.slice(0, 3));
  const previousThree = average(units.slice(3, 6));
  const annualAverage = average(units);

  if (recentThree >= annualAverage * 1.35 && recentThree >= previousThree * 1.15) {
    return recent >= recentThree ? "시즌 중" : "시즌 진입";
  }
  if (previousThree >= annualAverage * 1.35 && recentThree <= previousThree * 0.72) {
    return "시즌 종료 임박";
  }
  if (recentThree <= annualAverage * 0.55) return "비시즌";
  return "계절성 불명확";
}

function daysSince(lastSaleAt: string | null | undefined, asOf: Date) {
  const timestamp = validDate(lastSaleAt);
  if (timestamp === null) return null;
  return Math.max(0, Math.floor((asOf.valueOf() - timestamp) / DAY_MS));
}

function gradeFromDeclineSignals(
  signalCount: number,
  noSale120: boolean,
  recent90: number,
  seasonalWithoutYearOverYearDecline: boolean,
): ProductPriceGrade {
  let grade: ProductPriceGrade =
    signalCount >= 4 || (noSale120 && recent90 <= 0)
      ? -4
      : signalCount >= 3
        ? -3
        : signalCount >= 2
          ? -2
          : signalCount >= 1
            ? -1
            : 0;
  if (seasonalWithoutYearOverYearDecline && grade < -2) grade = -2;
  return grade;
}

export function calculateProductPriceGrade(
  input: ProductPriceGradeInput,
): ProductPriceGradeResult {
  const asOf = new Date(input.asOf || new Date().toISOString());
  if (!Number.isFinite(asOf.valueOf())) {
    throw new Error("PRICE_GRADE_AS_OF_INVALID");
  }
  const barcode = String(input.barcode ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase();
  const currentPrice = Math.max(0, Math.round(Number(input.currentPrice) || 0));
  const previousGrade = clampGrade(input.currentGrade);
  const units = safeUnits(input.monthlyUnits);
  const historyMonths = input.monthlyUnits.length;
  const activeMonths = units.filter((value) => value > 0).length;
  const recent30 = units[0];
  const previous30 = units[1];
  const recent90 = sum(units.slice(0, 3));
  const previous90 = sum(units.slice(3, 6));
  const priorYear90 = sum(units.slice(12, 15));
  const recent365 = sum(units.slice(0, 12));
  const prior365 = sum(units.slice(12, 24));
  const lastSaleDays = daysSince(input.lastSaleAt, asOf);
  const receipt = calculateProtectedReceiptCost(input.receipts, asOf);
  const marginFloorPrice = ceilToTen(receipt.protectionCost * 2);
  const seasonState = detectPriceSeasonState(units);
  const blockedReasons: string[] = [];

  if (!/^[A-Z]{3}\d+-\d+$/.test(barcode)) blockedReasons.push("위치코드형 바코드 없음");
  if (currentPrice <= 0) blockedReasons.push("현재 판매가 없음");
  if (receipt.latestCost <= 0) blockedReasons.push("확정 입고원가 없음");
  if (input.active === false) blockedReasons.push("판매중지·비활성 상태");

  const declineSignals: string[] = [];
  const yearOverYear90Decline =
    priorYear90 > 0 && rateDecrease(recent90, priorYear90) >= 0.3;
  if (yearOverYear90Decline) declineSignals.push("최근90일_전년동기30퍼센트감소");
  if (previous90 > 0 && rateDecrease(recent90, previous90) >= 0.3) {
    declineSignals.push("최근90일_직전90일30퍼센트감소");
  }
  if (prior365 > 0 && rateDecrease(recent365, prior365) >= 0.25) {
    declineSignals.push("최근365일_직전365일25퍼센트감소");
  }
  const noSale120 = lastSaleDays !== null && lastSaleDays >= 120;
  if (noSale120) declineSignals.push("마지막판매120일경과");

  const launchTimestamp = validDate(input.launchedAt);
  const ageDays = launchTimestamp === null
    ? null
    : Math.max(0, Math.floor((asOf.valueOf() - launchTimestamp) / DAY_MS));
  const newProduct = ageDays !== null && ageDays < 90;
  const increaseEligible =
    !newProduct && recent30 >= 30 && recent30 >= previous30;

  const seasonalWithoutYearOverYearDecline =
    ["시즌 종료 임박", "비시즌"].includes(seasonState) &&
    !yearOverYear90Decline;
  let grade = newProduct
    ? (0 as ProductPriceGrade)
    : gradeFromDeclineSignals(
        declineSignals.length,
        noSale120,
        recent90,
        seasonalWithoutYearOverYearDecline,
      );

  if (grade === 0 && increaseEligible) {
    grade = Math.min(6, Math.max(0, previousGrade) + 1) as ProductPriceGrade;
  } else if (
    previousGrade > 0 &&
    recent30 < previous30 * 0.8 &&
    declineSignals.length === 0
  ) {
    grade = Math.max(0, previousGrade - 1) as ProductPriceGrade;
  }

  let decision: PriceGradeDecision = "hold";
  let recommendedPrice = currentPrice;
  let defaultSelected = false;
  const reasons: string[] = [];

  if (blockedReasons.length) {
    decision = "blocked";
  } else if (currentPrice < receipt.latestCost * 2) {
    decision = "increase_required";
    recommendedPrice = Math.max(currentPrice, ceilToTen(receipt.latestCost * 2));
    defaultSelected = true;
    reasons.push("최근 확정 입고원가의 2배보다 판매가가 낮아 마진 방어 인상이 필요합니다.");
  } else if (grade > 0) {
    decision = "increase_required";
    recommendedPrice = Math.max(
      marginFloorPrice,
      percentagePrice(currentPrice, grade * 0.05),
    );
    defaultSelected = true;
    reasons.push(`판매등급 +${grade}에 따라 현재가에서 ${grade * 5}% 인상안을 계산했습니다.`);
  } else if (grade === -3 && historyMonths >= 15 && declineSignals.length >= 2) {
    decision = "decrease_review";
    const markdownRate = input.markdownStage === 1 ? -0.2 : -0.1;
    recommendedPrice = Math.max(
      marginFloorPrice,
      percentagePrice(currentPrice, markdownRate),
    );
    reasons.push(
      input.markdownStage === 1
        ? "-3등급 1차 인하 후에도 판매회복이 없어 20% 인하 검토안입니다."
        : "-3등급으로 10% 인하 후 완판·판매회복 여부를 검토합니다.",
    );
  } else if (grade === -4 && historyMonths >= 15 && declineSignals.length >= 2) {
    decision = "discontinued_review";
    recommendedPrice = Math.max(
      marginFloorPrice,
      percentagePrice(currentPrice, -0.3),
    );
    reasons.push("-4등급으로 30% 재고정리 가격을 검토하고 이후 미판매 시 단종을 확정합니다.");
  } else if (grade === -1 || grade === -2) {
    reasons.push(`${grade}등급은 가격을 내리지 않고 판매추이만 관찰합니다.`);
  } else if (newProduct) {
    reasons.push("출시 3개월 미만 신규상품은 가격등급 평가를 보류합니다.");
  } else {
    reasons.push("현재 가격을 유지할 조건입니다.");
  }

  if (seasonalWithoutYearOverYearDecline) {
    reasons.push("비시즌 가능성이 있어 전년동기 감소가 확인되기 전에는 -3 이하로 낮추지 않았습니다.");
  }
  if (receipt.protectionCost > receipt.latestCost) {
    reasons.push("최근 365일 내 최근 입고 3회 중 최고원가를 가격인하 보호원가로 사용했습니다.");
  }
  if (decision === "decrease_review" || decision === "discontinued_review") {
    reasons.push(`인하 후 가격은 보호원가 2배인 ${marginFloorPrice.toLocaleString("ko-KR")}원 아래로 내려가지 않습니다.`);
  }

  const adjustmentRate = currentPrice > 0
    ? Math.round(((recommendedPrice - currentPrice) / currentPrice) * 10_000) /
      10_000
    : 0;

  return {
    ruleVersion: PRICE_GRADE_RULE_VERSION,
    barcode,
    grade,
    previousGrade,
    decision,
    seasonState,
    latestCost: receipt.latestCost,
    protectionCost: receipt.protectionCost,
    marginFloorPrice,
    currentPrice,
    recommendedPrice,
    adjustmentRate,
    defaultSelected,
    declineSignals,
    reasons: reasons.slice(0, 6),
    blockedReasons,
    evidence: {
      recent30,
      previous30,
      recent90,
      previous90,
      priorYear90,
      recent365,
      prior365,
      activeMonths,
      historyMonths,
      daysSinceLastSale: lastSaleDays,
      increaseEligible,
      declineSignalCount: declineSignals.length,
    },
  };
}

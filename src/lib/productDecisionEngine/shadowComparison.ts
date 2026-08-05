import {
  replayProductDecisionFromD1,
  type D1ProductDecisionReplay,
  type PortableD1ProductDecisionTables,
} from "./d1SourceAdapter.ts";

export type ProductDecisionShadowMismatchReason =
  | "SOURCE_INPUT_DRIFT"
  | "PORTFOLIO_BUDGET_DRIFT"
  | "UNEXPLAINED";

export type ProductDecisionShadowProduct = {
  barcode: string;
  sourceInputDrift: boolean;
  salesCalculationMatch: boolean;
  expectedGroup: string;
  replayGroup: string;
  expectedQuantity: number;
  replayQuantity: number;
  expectedCost: number;
  replayCost: number;
  finalMatch: boolean;
  mismatchReason: ProductDecisionShadowMismatchReason | null;
};

export type ProductDecisionShadowReport = {
  runId: string;
  analysisAsOf: string;
  productCount: number;
  exactFinalCount: number;
  finalMismatchCount: number;
  sourceInputDriftCount: number;
  salesCalculationMismatchCount: number;
  unexplainedMismatchCount: number;
  expectedProductOrderBudget: number;
  replayProductOrderBudget: number;
  productOrderBudgetDelta: number;
  expectedSpend: number;
  replayExpectedSpend: number;
  expectedOrderCount: number;
  replayOrderCount: number;
  products: ProductDecisionShadowProduct[];
};

export type ProductDecisionShadowReplayResult = {
  replay: D1ProductDecisionReplay;
  report: ProductDecisionShadowReport;
};

const SALES_FIELDS = [
  "group",
  "priorityScore",
  "forecastUnits",
  "rawRecommendedQuantity",
  "recommendedQuantity",
  "oneMonthGrowthRate",
  "twoMonthGrowthRate",
  "recentThreeMonthAverage",
  "activeSalesMonths",
  "trendLabel",
  "seasonState",
  "confidence",
] as const;

export function replayAndCompareProductDecisionD1(
  tables: PortableD1ProductDecisionTables,
): ProductDecisionShadowReplayResult {
  const replay = replayProductDecisionFromD1(tables);
  return {
    replay,
    report: compareProductDecisionReplay(tables, replay),
  };
}

export function compareProductDecisionReplay(
  tables: PortableD1ProductDecisionTables,
  replay: D1ProductDecisionReplay,
): ProductDecisionShadowReport {
  const runId = replay.source.runId;
  const expectedRun = (tables.decision_runs ?? [])
    .map(record)
    .find((row) => text(row.id) === runId);
  if (!expectedRun) throw new Error("D1_SHADOW_EXPECTED_RUN_NOT_FOUND");

  const expectedItems = new Map(
    (tables.decision_items ?? [])
      .map(record)
      .filter((row) => text(row.run_id) === runId)
      .map((row) => [normalizeBarcode(row.barcode), row] as const),
  );
  const evidence = new Map(
    (tables.decision_evidence ?? [])
      .map(record)
      .filter((row) => text(row.run_id) === runId)
      .map((row) => [normalizeBarcode(row.barcode), row] as const),
  );
  const replayItems = new Map(
    replay.plan.products.map((row) => [normalizeBarcode(row.input.barcode), row]),
  );

  const budgetDrift =
    integer(expectedRun.budget) !== replay.plan.productOrderBudget;
  const products: ProductDecisionShadowProduct[] = [];

  for (const source of replay.source.products) {
    const barcode = normalizeBarcode(source.barcode);
    const expected = expectedItems.get(barcode);
    const expectedEvidence = evidence.get(barcode);
    const actual = replayItems.get(barcode);
    if (!expected || !actual) {
      throw new Error(`D1_SHADOW_PRODUCT_MISSING:${barcode}`);
    }

    const calculation = safeJsonObject(expectedEvidence?.calculation_json);
    const expectedRollingUnits = numberArray(calculation.rollingUnits, 12);
    const expectedRollingRevenue = numberArray(calculation.rollingRevenue, 12);
    const sourceInputDrift =
      !sameNumbers(source.rollingUnits, expectedRollingUnits) ||
      !sameNumbers(source.rollingRevenue, expectedRollingRevenue);
    const expectedOrder = record(calculation.order);
    const salesCalculationMatch = SALES_FIELDS.every((field) =>
      sameScalar(actual.sales[field], expectedOrder[field]),
    );

    const expectedGroup = text(expected.decision_status);
    const replayGroup = actual.finalGroup;
    const expectedQuantity = integer(expected.recommended_quantity_gross);
    const replayQuantity = integer(actual.finalQuantity);
    const expectedCost = integer(expected.expected_cost);
    const replayCost = integer(actual.expectedCost);
    const finalMatch =
      expectedGroup === replayGroup &&
      expectedQuantity === replayQuantity &&
      expectedCost === replayCost;
    const mismatchReason = finalMatch
      ? null
      : sourceInputDrift
        ? "SOURCE_INPUT_DRIFT"
        : budgetDrift
          ? "PORTFOLIO_BUDGET_DRIFT"
          : "UNEXPLAINED";

    products.push({
      barcode,
      sourceInputDrift,
      salesCalculationMatch,
      expectedGroup,
      replayGroup,
      expectedQuantity,
      replayQuantity,
      expectedCost,
      replayCost,
      finalMatch,
      mismatchReason,
    });
  }

  const expectedSpend = [...expectedItems.values()]
    .filter((row) =>
      ["발주 추천", "소량 검토"].includes(text(row.decision_status)),
    )
    .reduce((total, row) => total + integer(row.expected_cost), 0);
  const expectedOrderCount = [...expectedItems.values()].filter((row) =>
    ["발주 추천", "소량 검토"].includes(text(row.decision_status)),
  ).length;
  const exactFinalCount = products.filter((row) => row.finalMatch).length;

  return {
    runId,
    analysisAsOf: replay.source.analysisAsOf,
    productCount: products.length,
    exactFinalCount,
    finalMismatchCount: products.length - exactFinalCount,
    sourceInputDriftCount: products.filter((row) => row.sourceInputDrift).length,
    salesCalculationMismatchCount: products.filter(
      (row) => !row.salesCalculationMatch,
    ).length,
    unexplainedMismatchCount: products.filter(
      (row) => row.mismatchReason === "UNEXPLAINED",
    ).length,
    expectedProductOrderBudget: integer(expectedRun.budget),
    replayProductOrderBudget: replay.plan.productOrderBudget,
    productOrderBudgetDelta:
      replay.plan.productOrderBudget - integer(expectedRun.budget),
    expectedSpend,
    replayExpectedSpend: replay.plan.expectedSpend,
    expectedOrderCount,
    replayOrderCount: replay.plan.products.filter((row) =>
      ["발주 추천", "소량 검토"].includes(row.finalGroup),
    ).length,
    products,
  };
}

function safeJsonObject(value: unknown) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return record(parsed);
  } catch {
    return {};
  }
}

function numberArray(value: unknown, length: number) {
  const values = Array.isArray(value) ? value : [];
  return Array.from({ length }, (_, index) => number(values[index]));
}

function sameNumbers(left: number[], right: number[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => sameScalar(value, right[index]))
  );
}

function sameScalar(left: unknown, right: unknown) {
  if (typeof left === "number" || typeof right === "number") {
    return Math.abs(number(left) - number(right)) < 0.000_001;
  }
  return String(left ?? "") === String(right ?? "");
}

function normalizeBarcode(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: unknown) {
  return Math.max(0, Math.round(number(value)));
}

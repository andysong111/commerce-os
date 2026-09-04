import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const OPERATION_TYPE = "PURCHASE_RECOMMENDATION_FINALIZED";

export type PurchaseV2FeedbackReference = {
  cycleMonth: string;
  finalizedAt: string;
  rows: Array<{
    barcode: string;
    monthlyDemandForecast: number;
    feedbackMultiplier?: number;
    stockoutRecoveredUnits?: number;
    priceChangeRate?: number | null;
  }>;
};

type StoredRow = {
  result_snapshot?: unknown;
  started_at?: unknown;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseReference(row: StoredRow): PurchaseV2FeedbackReference | null {
  const result = object(row.result_snapshot);
  const source = Object.keys(object(result.snapshot)).length
    ? object(result.snapshot)
    : result;
  const report = object(source.report);
  const cycleMonth = text(source.cycleMonth || report.cycleMonth);
  const finalizedAt = text(source.finalizedAt || row.started_at);
  const sourceRows = Array.isArray(report.rows) ? report.rows : [];
  if (
    !/^\d{4}-\d{2}$/.test(cycleMonth) ||
    !Number.isFinite(Date.parse(finalizedAt)) ||
    !sourceRows.length
  ) {
    return null;
  }
  return {
    cycleMonth,
    finalizedAt: new Date(finalizedAt).toISOString(),
    rows: sourceRows
      .map((value) => object(value))
      .map((value) => ({
        barcode: text(value.barcode).toUpperCase().replace(/\s+/g, ""),
        monthlyDemandForecast: Math.max(
          0,
          Math.round(number(value.monthlyDemandForecast)),
        ),
        feedbackMultiplier: number(value.feedbackMultiplier) || undefined,
        stockoutRecoveredUnits: Math.max(
          0,
          Math.round(number(value.stockoutRecoveredUnits)),
        ),
        priceChangeRate:
          value.priceChangeRate === null || value.priceChangeRate === undefined
            ? null
            : number(value.priceChangeRate),
      }))
      .filter((value) => value.barcode),
  };
}

export async function loadPreviousPurchaseV2FeedbackReference(
  currentCycleMonth: string,
): Promise<PurchaseV2FeedbackReference | null> {
  const admin = await createSupabaseAdminClient();
  if (!admin) return null;
  const result = await admin
    .from("commerce_operation_runs")
    .select("result_snapshot,started_at")
    .eq("operation_type", OPERATION_TYPE)
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: false })
    .limit(120);
  if (result.error) return null;
  const references = (Array.isArray(result.data) ? result.data : [])
    .map((row) => parseReference(row as StoredRow))
    .filter(
      (row): row is PurchaseV2FeedbackReference =>
        Boolean(row && row.cycleMonth < currentCycleMonth),
    )
    .sort(
      (left, right) =>
        right.cycleMonth.localeCompare(left.cycleMonth) ||
        Date.parse(right.finalizedAt) - Date.parse(left.finalizedAt),
    );
  return references[0] ?? null;
}

export function purchaseV2FeedbackMultiplier(input: {
  previousMonthlyForecast: number;
  previousFeedbackMultiplier?: number;
  actualRecent30Units: number;
  previousStockoutRecoveredUnits?: number;
  previousPriceChangeRate?: number | null;
}) {
  const forecast = Math.max(0, number(input.previousMonthlyForecast));
  const actual = Math.max(0, number(input.actualRecent30Units));
  const previous = Math.min(
    1.25,
    Math.max(0.75, number(input.previousFeedbackMultiplier) || 1),
  );
  const distorted =
    number(input.previousStockoutRecoveredUnits) > 0 ||
    Math.abs(number(input.previousPriceChangeRate)) >= 10;
  if (forecast < 5 || distorted) return previous;
  const ratio = actual / forecast;
  const oneCycleStep = Math.min(1.1, Math.max(0.9, 1 + (ratio - 1) * 0.1));
  return Math.round(
    Math.min(1.25, Math.max(0.75, previous * oneCycleStep)) * 1000,
  ) / 1000;
}

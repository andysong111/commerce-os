import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { PurchaseV2RecommendationReport } from "@/lib/purchaseV2Recommendation";

export const PURCHASE_V2_FINALIZED_OPERATION_TYPE =
  "PURCHASE_RECOMMENDATION_FINALIZED";

const READ_LIMIT = 48;

export type FinalizedPurchaseV2Snapshot = {
  finalizedAt: string;
  cycleMonth: string;
  budgetMonth: string;
  fingerprint: string;
  effectiveCashKrw: number;
  productOrderBudgetKrw: number;
  expectedProductSpendKrw: number;
  expectedAllInSpendKrw: number;
  remainingCashKrw: number;
  recommendedSkuCount: number;
  rows: PurchaseV2RecommendationReport["rows"];
  report: PurchaseV2RecommendationReport;
};

type StoredRow = {
  result_snapshot?: unknown;
  started_at?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validReport(report: PurchaseV2RecommendationReport) {
  if (report.state !== "READY") {
    throw new Error("PURCHASE_V2_FINALIZE_REPORT_NOT_READY");
  }
  if (!/^\d{4}-\d{2}$/.test(report.cycleMonth)) {
    throw new Error("PURCHASE_V2_FINALIZE_CYCLE_INVALID");
  }
  if (!report.fingerprint.startsWith("sha256:")) {
    throw new Error("PURCHASE_V2_FINALIZE_FINGERPRINT_INVALID");
  }
  if (report.effectiveCashKrw <= 0) {
    throw new Error("PURCHASE_V2_FINALIZE_CASH_INVALID");
  }
  if (!Array.isArray(report.rows) || !report.rows.length) {
    throw new Error("PURCHASE_V2_FINALIZE_ROWS_EMPTY");
  }
}

export async function finalizePurchaseV2Recommendation(
  report: PurchaseV2RecommendationReport,
): Promise<{ snapshot: FinalizedPurchaseV2Snapshot; duplicate: boolean }> {
  validReport(report);
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const finalizedAt = new Date().toISOString();
  const snapshot: FinalizedPurchaseV2Snapshot = {
    finalizedAt,
    cycleMonth: report.cycleMonth,
    budgetMonth: report.budgetMonth,
    fingerprint: report.fingerprint,
    effectiveCashKrw: report.effectiveCashKrw,
    productOrderBudgetKrw: report.productOrderBudgetKrw,
    expectedProductSpendKrw: report.expectedProductSpendKrw,
    expectedAllInSpendKrw: report.expectedAllInSpendKrw,
    remainingCashKrw: report.remainingCashKrw,
    recommendedSkuCount: report.recommendedSkuCount,
    rows: report.rows.filter((row) => row.allocatedQuantity > 0),
    report,
  };
  const sourceEventId =
    `purchase-v2-finalized:${report.cycleMonth}:` +
    report.fingerprint.replace(/^sha256:/, "");
  const result = await admin
    .from("commerce_operation_runs")
    .upsert(
      [
        {
          operation_type: PURCHASE_V2_FINALIZED_OPERATION_TYPE,
          status: "SUCCEEDED",
          source: "COMMERCE_OS_PURCHASE_V2",
          source_event_id: sourceEventId,
          correlation_id: `purchase-v2:${report.cycleMonth}`,
          actor_type: "OPS_OPERATOR",
          input_snapshot: {
            cycleMonth: report.cycleMonth,
            budgetMonth: report.budgetMonth,
            fingerprint: report.fingerprint,
            effectiveCashKrw: report.effectiveCashKrw,
          },
          result_snapshot: snapshot,
          error_message: null,
          started_at: finalizedAt,
          finished_at: finalizedAt,
          updated_at: finalizedAt,
        },
      ],
      { onConflict: "source_event_id", ignoreDuplicates: true },
    )
    .select("id,source_event_id");
  if (result.error) {
    throw new Error(`PURCHASE_V2_FINALIZE_STORE_FAILED:${result.error.message}`);
  }
  return {
    snapshot,
    duplicate: !Array.isArray(result.data) || result.data.length === 0,
  };
}

function parseSnapshot(value: unknown): FinalizedPurchaseV2Snapshot | null {
  const row = object(value);
  const report = object(row.report) as unknown as PurchaseV2RecommendationReport;
  const finalizedAt = text(row.finalizedAt);
  const cycleMonth = text(row.cycleMonth);
  const fingerprint = text(row.fingerprint);
  if (
    !finalizedAt ||
    !/^\d{4}-\d{2}$/.test(cycleMonth) ||
    !fingerprint.startsWith("sha256:") ||
    !Array.isArray(row.rows)
  ) {
    return null;
  }
  return {
    finalizedAt,
    cycleMonth,
    budgetMonth: text(row.budgetMonth),
    fingerprint,
    effectiveCashKrw: Number(row.effectiveCashKrw) || 0,
    productOrderBudgetKrw: Number(row.productOrderBudgetKrw) || 0,
    expectedProductSpendKrw: Number(row.expectedProductSpendKrw) || 0,
    expectedAllInSpendKrw: Number(row.expectedAllInSpendKrw) || 0,
    remainingCashKrw: Number(row.remainingCashKrw) || 0,
    recommendedSkuCount: Number(row.recommendedSkuCount) || 0,
    rows: row.rows as PurchaseV2RecommendationReport["rows"],
    report,
  };
}

export async function loadFinalizedPurchaseV2Recommendations(
  limitInput: unknown = 12,
): Promise<FinalizedPurchaseV2Snapshot[]> {
  const admin = await createSupabaseAdminClient();
  if (!admin) return [];
  const limit = Math.min(48, Math.max(1, Math.round(Number(limitInput) || 12)));
  const result = await admin
    .from("commerce_operation_runs")
    .select("result_snapshot,started_at")
    .eq("operation_type", PURCHASE_V2_FINALIZED_OPERATION_TYPE)
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: false })
    .limit(READ_LIMIT);
  if (result.error) return [];
  const byMonth = new Map<string, FinalizedPurchaseV2Snapshot>();
  for (const stored of result.data ?? []) {
    const snapshot = parseSnapshot((stored as StoredRow).result_snapshot);
    if (!snapshot || byMonth.has(snapshot.cycleMonth)) continue;
    byMonth.set(snapshot.cycleMonth, snapshot);
  }
  return [...byMonth.values()]
    .sort((left, right) => right.cycleMonth.localeCompare(left.cycleMonth))
    .slice(0, limit);
}

export async function loadFinalizedPurchaseV2Recommendation(
  cycleMonth: string,
) {
  const rows = await loadFinalizedPurchaseV2Recommendations(48);
  return rows.find((row) => row.cycleMonth === cycleMonth) ?? null;
}

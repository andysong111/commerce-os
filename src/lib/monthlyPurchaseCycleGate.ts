import { monthlyPurchaseCycleFor } from "@/lib/monthlyPurchasePolicy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const PRODUCT_DECISION_LIVE_REQUEST = "PRODUCT_DECISION_LIVE_REFRESH_REQUEST";

type OperationRow = {
  input_snapshot?: unknown;
  started_at?: unknown;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

export type MonthlyPurchaseCycleGate = {
  cycleMonth: string;
  budgetMonth: string;
  locked: boolean;
  existingRequestId: string | null;
  existingCreatedAt: string | null;
};

export async function loadMonthlyPurchaseCycleGate(
  now: Date | string = new Date(),
): Promise<MonthlyPurchaseCycleGate> {
  const cycle = monthlyPurchaseCycleFor(now);
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return {
      cycleMonth: cycle.cycleMonth,
      budgetMonth: cycle.budgetMonth,
      locked: false,
      existingRequestId: null,
      existingCreatedAt: null,
    };
  }

  const result = await admin
    .from("commerce_operation_runs")
    .select("input_snapshot,started_at")
    .eq("operation_type", PRODUCT_DECISION_LIVE_REQUEST)
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: false })
    .limit(100);
  if (result.error) throw new Error(result.error.message);

  const rows = (Array.isArray(result.data) ? result.data : []).filter(
    (row): row is OperationRow => Boolean(row && typeof row === "object"),
  );
  for (const row of rows) {
    const input = object(row.input_snapshot);
    const analysisAsOf = text(input.analysisAsOf) || text(row.started_at);
    if (!analysisAsOf) continue;
    let rowCycle: string;
    try {
      rowCycle = text(input.cycleMonth) || monthlyPurchaseCycleFor(analysisAsOf).cycleMonth;
    } catch {
      continue;
    }
    if (rowCycle !== cycle.cycleMonth) continue;
    return {
      cycleMonth: cycle.cycleMonth,
      budgetMonth: cycle.budgetMonth,
      locked: true,
      existingRequestId: text(input.requestId) || null,
      existingCreatedAt: analysisAsOf,
    };
  }

  return {
    cycleMonth: cycle.cycleMonth,
    budgetMonth: cycle.budgetMonth,
    locked: false,
    existingRequestId: null,
    existingCreatedAt: null,
  };
}

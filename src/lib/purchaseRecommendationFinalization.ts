import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const PURCHASE_RECOMMENDATION_FINALIZED_OPERATION_TYPE =
  "PURCHASE_RECOMMENDATION_FINALIZED";

const READ_LIMIT = 120;
const DAY_MS = 86_400_000;

export type FinalizedPurchaseRecommendationRow = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  pattern: string;
  decision: string;
  forecast30Quantity: number;
  target44Quantity: number;
  inventorySource: string;
  inventoryLowQuantity: number;
  inventoryHighQuantity: number;
  openCommitmentQuantity: number;
  recommendedQuantity: number;
  allocatedQuantity: number;
  unitCostKrw: number;
  expectedProductCostKrw: number;
  priceEffect: string;
  stockoutDemandRecovered: number;
  recent30StockoutDays: number;
  priorityScore: number;
};

export type FinalizedPurchaseRecommendation = {
  finalizationId: string;
  cycleMonth: string;
  budgetMonth: string;
  generatedAt: string;
  finalizedAt: string;
  requestedCashKrw: number;
  effectiveCashKrw: number;
  productOrderBudgetKrw: number;
  expectedProductSpendKrw: number;
  expectedAllInSpendKrw: number;
  remainingCashKrw: number;
  calculationFingerprint: string;
  ruleVersion: string;
  rows: FinalizedPurchaseRecommendationRow[];
};

type StoredRow = {
  source_event_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
};

type SaleEvent = {
  barcode: string;
  occurredAt: string;
  quantity: number;
  validSale: boolean;
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

function quantity(value: unknown) {
  return Math.max(0, Math.round(number(value)));
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function month(value: unknown) {
  const normalized = text(value);
  return /^\d{4}-\d{2}$/.test(normalized) ? normalized : "";
}

function barcode(value: unknown) {
  const normalized = text(value).toUpperCase().replace(/\s+/g, "");
  return /^B[A-Z]{2}\d+-\d+$/.test(normalized) ? normalized : "";
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function normalizeRow(value: unknown): FinalizedPurchaseRecommendationRow | null {
  const row = object(value);
  const normalizedBarcode = barcode(row.barcode);
  if (!normalizedBarcode) return null;
  return {
    barcode: normalizedBarcode,
    modelNo: text(row.modelNo) || null,
    productName: text(row.productName) || normalizedBarcode,
    pattern: text(row.pattern),
    decision: text(row.decision),
    forecast30Quantity: quantity(row.forecast30Quantity),
    target44Quantity: quantity(row.target44Quantity),
    inventorySource: text(row.inventorySource),
    inventoryLowQuantity: quantity(row.inventoryLowQuantity),
    inventoryHighQuantity: quantity(row.inventoryHighQuantity),
    openCommitmentQuantity: quantity(row.openCommitmentQuantity),
    recommendedQuantity: quantity(row.recommendedQuantity),
    allocatedQuantity: quantity(row.allocatedQuantity),
    unitCostKrw: quantity(row.unitCostKrw),
    expectedProductCostKrw: quantity(row.expectedProductCostKrw),
    priceEffect: text(row.priceEffect),
    stockoutDemandRecovered: quantity(row.stockoutDemandRecovered),
    recent30StockoutDays: quantity(row.recent30StockoutDays),
    priorityScore: quantity(row.priorityScore),
  };
}

export function normalizePurchaseRecommendationFinalization(
  input: Record<string, unknown>,
): FinalizedPurchaseRecommendation {
  const finalizationId = text(input.finalizationId);
  const cycleMonth = month(input.cycleMonth);
  const budgetMonth = month(input.budgetMonth);
  const generatedAt = iso(input.generatedAt);
  const finalizedAt = input.finalizedAt
    ? iso(input.finalizedAt)
    : new Date().toISOString();
  const rows = (Array.isArray(input.rows) ? input.rows : [])
    .map(normalizeRow)
    .filter(
      (row): row is FinalizedPurchaseRecommendationRow => Boolean(row),
    );
  if (!finalizationId) {
    throw new Error("PURCHASE_FINALIZATION_ID_REQUIRED");
  }
  if (!cycleMonth || !budgetMonth) {
    throw new Error("PURCHASE_FINALIZATION_MONTH_INVALID");
  }
  if (!generatedAt || !finalizedAt) {
    throw new Error("PURCHASE_FINALIZATION_TIME_INVALID");
  }
  if (!rows.length) {
    throw new Error("PURCHASE_FINALIZATION_ROWS_REQUIRED");
  }
  if (!text(input.calculationFingerprint)) {
    throw new Error("PURCHASE_FINALIZATION_FINGERPRINT_REQUIRED");
  }
  return {
    finalizationId,
    cycleMonth,
    budgetMonth,
    generatedAt,
    finalizedAt,
    requestedCashKrw: quantity(input.requestedCashKrw),
    effectiveCashKrw: quantity(input.effectiveCashKrw),
    productOrderBudgetKrw: quantity(input.productOrderBudgetKrw),
    expectedProductSpendKrw: quantity(input.expectedProductSpendKrw),
    expectedAllInSpendKrw: quantity(input.expectedAllInSpendKrw),
    remainingCashKrw: quantity(input.remainingCashKrw),
    calculationFingerprint: text(input.calculationFingerprint),
    ruleVersion: text(input.ruleVersion),
    rows,
  };
}

function parseStored(row: StoredRow): FinalizedPurchaseRecommendation | null {
  const result = object(row.result_snapshot);
  const nested = object(result.snapshot);
  const source = Object.keys(nested).length
    ? nested
    : Object.keys(result).length
      ? result
      : object(row.input_snapshot);
  try {
    return normalizePurchaseRecommendationFinalization(source);
  } catch {
    return null;
  }
}

export async function savePurchaseRecommendationFinalization(
  input: Record<string, unknown>,
) {
  const snapshot = normalizePurchaseRecommendationFinalization(input);
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const sourceEventId = `purchase-finalized:${snapshot.cycleMonth}:${snapshot.finalizationId}`;
  const result = await admin
    .from("commerce_operation_runs")
    .upsert(
      {
        operation_type: PURCHASE_RECOMMENDATION_FINALIZED_OPERATION_TYPE,
        status: "SUCCEEDED",
        source: "COMMERCE_OS_PURCHASE_V2",
        source_event_id: sourceEventId,
        correlation_id: `purchase-cycle:${snapshot.cycleMonth}`,
        actor_type: "OPS_OPERATOR",
        input_snapshot: snapshot,
        result_snapshot: {
          accepted: true,
          snapshot,
          rowCount: snapshot.rows.length,
          fingerprint: snapshot.calculationFingerprint,
        },
        error_message: null,
        started_at: snapshot.finalizedAt,
        finished_at: snapshot.finalizedAt,
        updated_at: snapshot.finalizedAt,
      },
      { onConflict: "source_event_id", ignoreDuplicates: true },
    )
    .select("id,source_event_id,started_at");
  if (result.error) {
    throw new Error(`PURCHASE_FINALIZATION_STORE_FAILED:${result.error.message}`);
  }
  return {
    duplicate: !result.data?.length,
    snapshot,
    sourceEventId,
  };
}

async function readStoredFinalizations() {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const result = await admin
    .from("commerce_operation_runs")
    .select("source_event_id,input_snapshot,result_snapshot,started_at")
    .eq("operation_type", PURCHASE_RECOMMENDATION_FINALIZED_OPERATION_TYPE)
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: false })
    .limit(READ_LIMIT);
  if (result.error) {
    throw new Error(`PURCHASE_FINALIZATION_READ_FAILED:${result.error.message}`);
  }
  return (result.data ?? []) as StoredRow[];
}

export async function loadPurchaseRecommendationFinalizations(
  cycleMonthInput?: unknown,
) {
  const targetMonth = month(cycleMonthInput);
  const snapshots = (await readStoredFinalizations())
    .map(parseStored)
    .filter(
      (snapshot): snapshot is FinalizedPurchaseRecommendation =>
        Boolean(snapshot),
    );
  const unique = new Map<string, FinalizedPurchaseRecommendation>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.cycleMonth}:${snapshot.finalizationId}`;
    if (!unique.has(key)) unique.set(key, snapshot);
  }
  return [...unique.values()]
    .filter((snapshot) => !targetMonth || snapshot.cycleMonth === targetMonth)
    .sort((left, right) => right.finalizedAt.localeCompare(left.finalizedAt));
}

export async function loadLatestPurchaseRecommendationFinalization(
  cycleMonthInput: unknown,
) {
  const values = await loadPurchaseRecommendationFinalizations(cycleMonthInput);
  return values[0] ?? null;
}

export async function loadPurchaseForecastFeedback(
  salesEvents: SaleEvent[],
  now = new Date(),
) {
  const finalizations = await loadPurchaseRecommendationFinalizations();
  const nowMs = now.getTime();
  const observations = new Map<
    string,
    Array<{ finalizedAt: string; multiplier: number }>
  >();
  for (const finalization of finalizations) {
    const startMs = Date.parse(finalization.finalizedAt);
    const endMs = startMs + 30 * DAY_MS;
    if (!Number.isFinite(startMs) || endMs > nowMs) continue;
    for (const row of finalization.rows) {
      if (
        row.forecast30Quantity <= 0 ||
        row.priceEffect === "DISCOUNT_DRIVEN_GROWTH" ||
        row.stockoutDemandRecovered > 0 ||
        row.recent30StockoutDays > 5
      ) {
        continue;
      }
      const actual = salesEvents
        .filter(
          (event) =>
            barcode(event.barcode) === row.barcode &&
            event.validSale &&
            Date.parse(event.occurredAt) >= startMs &&
            Date.parse(event.occurredAt) < endMs,
        )
        .reduce((total, event) => total + quantity(event.quantity), 0);
      const rawRatio = actual / row.forecast30Quantity;
      const boundedCycleMultiplier = Math.min(1.1, Math.max(0.9, rawRatio));
      const current = observations.get(row.barcode) ?? [];
      current.push({
        finalizedAt: finalization.finalizedAt,
        multiplier: boundedCycleMultiplier,
      });
      observations.set(row.barcode, current);
    }
  }
  const multipliers = new Map<string, number>();
  for (const [barcodeKey, values] of observations) {
    const recent = values
      .sort((left, right) => right.finalizedAt.localeCompare(left.finalizedAt))
      .slice(0, 3);
    const averageMultiplier =
      recent.reduce((total, row) => total + row.multiplier, 0) /
      recent.length;
    multipliers.set(
      barcodeKey,
      Math.min(1.25, Math.max(0.75, Math.round(averageMultiplier * 1000) / 1000)),
    );
  }
  return {
    multipliers,
    observationCount: [...observations.values()].reduce(
      (total, values) => total + values.length,
      0,
    ),
    fingerprint: sha256(
      [...multipliers.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}

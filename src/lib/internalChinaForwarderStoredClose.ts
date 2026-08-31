import type {
  InternalChinaForwarderCostSummary,
  InternalChinaReceiptCostReconciliation,
} from "./internalChinaForwarderCost";
import { createSupabaseAdminHeaders } from "./supabase/admin";

const OPERATION_TYPE = "INTERNAL_CHINA_FORWARDER_COST_CLOSE";
const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
const READ_TIMEOUT_MS = 1_800;

type StoredCostRow = {
  result_snapshot?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function decimal(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function boolean(value: unknown) {
  return value === true;
}

function sourceEventId(draftId: string) {
  return `internal-china-forwarder-cost:${draftId}`;
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

function reconciliation(value: unknown): InternalChinaReceiptCostReconciliation | null {
  const row = object(value);
  if (!Object.keys(row).length) return null;
  return {
    matchedRows: integer(row.matchedRows),
    updatedRows: integer(row.updatedRows),
    productMasterSynced: boolean(row.productMasterSynced),
    productMasterError: text(row.productMasterError) || null,
  };
}

export function parseStoredInternalChinaForwarderClose(
  draftId: string,
  row: StoredCostRow | undefined,
): InternalChinaForwarderCostSummary | null {
  const snapshot = object(row?.result_snapshot);
  if (text(snapshot.draftId) !== draftId) return null;

  const cycleMonth = text(snapshot.cycleMonth);
  const actualCostKrw = integer(snapshot.actualCostKrw);
  const productPurchaseCostKrw = integer(snapshot.productPurchaseCostKrw);
  const actualMultiplier = decimal(snapshot.actualMultiplier);
  if (
    !/^\d{4}-\d{2}$/.test(cycleMonth) ||
    actualCostKrw <= 0 ||
    productPurchaseCostKrw <= 0 ||
    actualMultiplier <= 0
  ) {
    return null;
  }

  return {
    draftId,
    cycleMonth,
    productPurchaseCostKrw,
    domesticChinaFreightKrw: integer(snapshot.domesticChinaFreightKrw),
    estimatedMultiplier: decimal(snapshot.estimatedMultiplier),
    estimatedForwarderCostKrw: integer(snapshot.estimatedForwarderCostKrw),
    estimatedTotalOutflowKrw: integer(snapshot.estimatedTotalOutflowKrw),
    actualCostKrw,
    actualTotalOutflowKrw: integer(snapshot.actualTotalOutflowKrw),
    actualMultiplier,
    closedAt:
      text(snapshot.closedAt) ||
      text(row?.updated_at) ||
      text(row?.started_at) ||
      null,
    appliesToProductUnitCost: true,
    appliesToPriceGrade: true,
    receiptCostReconciliation: reconciliation(snapshot.receiptCostReconciliation),
  };
}

export async function loadStoredInternalChinaForwarderClose(
  draftIdInput: unknown,
): Promise<InternalChinaForwarderCostSummary | null> {
  const draftId = text(draftIdInput);
  if (!DRAFT_ID.test(draftId)) {
    throw new Error("CHINA_FORWARDER_COST_DRAFT_INVALID");
  }

  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?operation_type=eq.${OPERATION_TYPE}&source_event_id=eq.${encodeURIComponent(sourceEventId(draftId))}&select=result_snapshot,started_at,updated_at&limit=1`,
    {
      headers: createSupabaseAdminHeaders(secret),
      cache: "no-store",
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`CHINA_FORWARDER_STORED_CLOSE_READ_FAILED:${response.status}`);
  }
  const rows = (await response.json().catch(() => [])) as StoredCostRow[];
  return parseStoredInternalChinaForwarderClose(draftId, rows[0]);
}

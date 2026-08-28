import { loadChinaOrderLedger } from "@/lib/chinaOrderLedger";
import { loadInternalChinaDraftWithQuantityOverrides } from "@/lib/internalChinaDraftQuantityOverride";
import {
  loadInternalChinaPurchaseDraft,
  type InternalChinaPurchaseDraft,
} from "@/lib/internalChinaPurchaseDraft";
import { seoulCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import { temporaryOpsIdentity } from "@/lib/opsLoginBypass";
import {
  mergePriceAdjustmentReceiptCachePage,
  readPriceAdjustmentReceiptCache,
  type PriceAdjustmentReceipt,
} from "@/lib/priceAdjustmentReceiptCache";
import { pushCanonicalProductMasterSnapshotFromTrackerState } from "@/lib/productMasterCanonicalSync";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
} from "@/lib/productLaunchTrackerServer";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

export const INTERNAL_CHINA_FORWARDER_COST_OPERATION_TYPE =
  "INTERNAL_CHINA_FORWARDER_COST_CLOSE";

const SOURCE_SYSTEM = "fast-purchase-mvp";
const SOURCE = "ops-center-internal-china-forwarder-cost";
const DRAFT_ID = /^fast-purchase-draft:[a-f0-9]{20}$/;
const MAX_ACTUAL_COST_KRW = 1_000_000_000;

type StoredCostRow = {
  result_snapshot?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
};

export type InternalChinaForwarderCostInput = {
  draftId?: unknown;
  cycleMonth?: unknown;
  actualCostKrw?: unknown;
};

export type InternalChinaReceiptCostReconciliation = {
  matchedRows: number;
  updatedRows: number;
  productMasterSynced: boolean;
  productMasterError: string | null;
};

export type InternalChinaForwarderCostSummary = {
  draftId: string;
  cycleMonth: string;
  productPurchaseCostKrw: number;
  estimatedMultiplier: number;
  estimatedForwarderCostKrw: number;
  estimatedTotalOutflowKrw: number;
  actualCostKrw: number | null;
  actualTotalOutflowKrw: number | null;
  actualMultiplier: number | null;
  closedAt: string | null;
  appliesToProductUnitCost: false;
  appliesToPriceGrade: false;
  receiptCostReconciliation?: InternalChinaReceiptCostReconciliation | null;
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

function validDraftId(value: unknown) {
  const draftId = text(value);
  if (!DRAFT_ID.test(draftId)) {
    throw new Error("CHINA_FORWARDER_COST_DRAFT_INVALID");
  }
  return draftId;
}

function validCycleMonth(value: unknown) {
  const cycleMonth = text(value);
  if (!/^\d{4}-\d{2}$/.test(cycleMonth)) {
    throw new Error("CHINA_FORWARDER_COST_CYCLE_MONTH_INVALID");
  }
  return cycleMonth;
}

function validActualCostKrw(value: unknown) {
  const actualCostKrw = integer(value);
  if (actualCostKrw <= 0) {
    throw new Error("CHINA_FORWARDER_COST_AMOUNT_REQUIRED");
  }
  if (actualCostKrw > MAX_ACTUAL_COST_KRW) {
    throw new Error("CHINA_FORWARDER_COST_AMOUNT_EXCEEDED");
  }
  return actualCostKrw;
}

function sourceEventId(draftId: string) {
  return `internal-china-forwarder-cost:${draftId}`;
}

function correlationId(draftId: string) {
  return `internal-china-purchase:${draftId}`;
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

function productUnitCostByBarcode(draft: InternalChinaPurchaseDraft) {
  const groups = new Map<string, { quantity: number; freight: number }>();
  for (const line of draft.lines) {
    const key = line.freightGroupId.trim() || `__${line.barcode}`;
    const current = groups.get(key) ?? { quantity: 0, freight: 0 };
    current.quantity += line.quantity;
    current.freight += decimal(line.domesticChinaFreightCny);
    groups.set(key, current);
  }

  const result = new Map<string, number>();
  for (const line of draft.lines) {
    const key = line.freightGroupId.trim() || `__${line.barcode}`;
    const group = groups.get(key) ?? { quantity: line.quantity, freight: 0 };
    const freightPerUnitCny =
      group.quantity > 0 ? group.freight / group.quantity : 0;
    const unitCny = decimal(line.unitPriceCny) + freightPerUnitCny;
    result.set(
      line.barcode,
      Math.max(1, Math.round(unitCny * draft.exchangeRateKrwPerCny)),
    );
  }
  return result;
}

function productPurchaseCostKrw(draft: InternalChinaPurchaseDraft) {
  const unitCosts = productUnitCostByBarcode(draft);
  return draft.lines.reduce(
    (total, line) =>
      total + (unitCosts.get(line.barcode) ?? 0) * line.quantity,
    0,
  );
}

function summaryFrom(
  draft: InternalChinaPurchaseDraft,
  cycleMonth: string,
  actualCostKrw: number | null,
  closedAt: string | null,
  receiptCostReconciliation: InternalChinaReceiptCostReconciliation | null = null,
): InternalChinaForwarderCostSummary {
  const productCost = productPurchaseCostKrw(draft);
  const estimatedTotal = Math.max(
    productCost,
    Math.round(productCost * draft.internalOrderCostMultiplier),
  );
  const estimatedForwarder = Math.max(0, estimatedTotal - productCost);
  const actualTotal =
    actualCostKrw === null ? null : productCost + actualCostKrw;
  const actualMultiplier =
    actualTotal === null || productCost <= 0
      ? null
      : Math.round((actualTotal / productCost) * 10_000) / 10_000;

  return {
    draftId: draft.draftId,
    cycleMonth,
    productPurchaseCostKrw: productCost,
    estimatedMultiplier: draft.internalOrderCostMultiplier,
    estimatedForwarderCostKrw: estimatedForwarder,
    estimatedTotalOutflowKrw: estimatedTotal,
    actualCostKrw,
    actualTotalOutflowKrw: actualTotal,
    actualMultiplier,
    closedAt,
    appliesToProductUnitCost: false,
    appliesToPriceGrade: false,
    receiptCostReconciliation,
  };
}

async function syncReceiptCostsToProductMaster() {
  const config = getProductLaunchAdminConfig();
  if (!config.ok) throw new Error(config.body.message);
  const identity = temporaryOpsIdentity();
  const stored = await readProductLaunchState(config.value, identity.userId);
  if (!stored?.state_payload || typeof stored.state_payload !== "object") {
    throw new Error("PRODUCT_LAUNCH_STATE_REQUIRED");
  }
  return pushCanonicalProductMasterSnapshotFromTrackerState(stored.state_payload);
}

async function reconcileProductOnlyReceiptCosts(
  draft: InternalChinaPurchaseDraft,
  cycleMonth: string,
): Promise<InternalChinaReceiptCostReconciliation> {
  const cache = await readPriceAdjustmentReceiptCache();
  if (!cache) {
    return {
      matchedRows: 0,
      updatedRows: 0,
      productMasterSynced: false,
      productMasterError: "PRICE_ADJUSTMENT_RECEIPT_CACHE_REQUIRED",
    };
  }

  const unitCosts = productUnitCostByBarcode(draft);
  const cycleBatchId = Number(cycleMonth.replace("-", ""));
  const corrections: PriceAdjustmentReceipt[] = [];
  let matchedRows = 0;

  for (const line of draft.lines) {
    const nextUnitCostKrw = unitCosts.get(line.barcode);
    if (!nextUnitCostKrw) continue;
    const rows = cache.receiptsByBarcode[line.barcode] ?? [];
    for (const row of rows) {
      if (
        row.batchId !== cycleBatchId ||
        !row.id.startsWith("china-receipt:")
      ) {
        continue;
      }
      matchedRows += 1;
      corrections.push({
        ...row,
        unitCostKrw: nextUnitCostKrw,
      });
    }
  }

  if (!corrections.length) {
    return {
      matchedRows,
      updatedRows: 0,
      productMasterSynced: false,
      productMasterError: "PRODUCT_ONLY_RECEIPT_ROWS_NOT_FOUND",
    };
  }

  await mergePriceAdjustmentReceiptCachePage({
    snapshotId: cache.snapshotId,
    generatedAt: new Date().toISOString(),
    complete: cache.complete,
    receipts: corrections,
  });

  try {
    await syncReceiptCostsToProductMaster();
    return {
      matchedRows,
      updatedRows: corrections.length,
      productMasterSynced: true,
      productMasterError: null,
    };
  } catch (error) {
    return {
      matchedRows,
      updatedRows: corrections.length,
      productMasterSynced: false,
      productMasterError:
        error instanceof Error
          ? error.message
          : "PRODUCT_MASTER_PRODUCT_ONLY_RECEIPT_SYNC_FAILED",
    };
  }
}

async function readStoredCost(draftId: string) {
  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?operation_type=eq.${INTERNAL_CHINA_FORWARDER_COST_OPERATION_TYPE}&source_event_id=eq.${encodeURIComponent(sourceEventId(draftId))}&select=result_snapshot,started_at,updated_at&limit=1`,
    {
      headers: createSupabaseAdminHeaders(secret),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    throw new Error(`CHINA_FORWARDER_COST_READ_FAILED:${response.status}`);
  }
  const rows = (await response.json().catch(() => [])) as StoredCostRow[];
  const row = rows[0];
  const snapshot = object(row?.result_snapshot);
  if (text(snapshot.draftId) !== draftId) return null;
  const actualCostKrw = integer(snapshot.actualCostKrw);
  if (actualCostKrw <= 0) return null;
  return {
    actualCostKrw,
    closedAt:
      text(snapshot.closedAt) ||
      text(row?.updated_at) ||
      text(row?.started_at) ||
      null,
  };
}

export async function loadInternalChinaForwarderCostSummary(
  draftIdInput: unknown,
  cycleMonthInput: unknown,
): Promise<InternalChinaForwarderCostSummary> {
  const draftId = validDraftId(draftIdInput);
  const cycleMonth = validCycleMonth(cycleMonthInput);
  const draft = await loadInternalChinaDraftWithQuantityOverrides(
    await loadInternalChinaPurchaseDraft(draftId),
  );
  const stored = await readStoredCost(draftId);
  return summaryFrom(
    draft,
    cycleMonth,
    stored?.actualCostKrw ?? null,
    stored?.closedAt ?? null,
  );
}

export async function recordInternalChinaForwarderCost(
  input: InternalChinaForwarderCostInput,
): Promise<InternalChinaForwarderCostSummary> {
  const draftId = validDraftId(input.draftId);
  const requestedCycleMonth = validCycleMonth(input.cycleMonth);
  const actualCostKrw = validActualCostKrw(input.actualCostKrw);

  const ledger = await loadChinaOrderLedger();
  if (ledger.error) {
    throw new Error(`CHINA_FORWARDER_COST_LEDGER_UNAVAILABLE:${ledger.error}`);
  }
  const commitments = ledger.commitments.filter(
    (row) => row.sourceSystem === SOURCE_SYSTEM && row.sourceRunId === draftId,
  );
  if (!commitments.length) {
    throw new Error("CHINA_FORWARDER_COST_DRAFT_NOT_FOUND");
  }
  const actualCycleMonth = seoulCalendarMonth(
    commitments.reduce((earliest, row) => {
      const candidate = row.reservedAt || row.updatedAt;
      if (!earliest) return candidate;
      return Date.parse(candidate) < Date.parse(earliest) ? candidate : earliest;
    }, ""),
  );
  if (actualCycleMonth !== requestedCycleMonth) {
    throw new Error(
      `CHINA_FORWARDER_COST_CYCLE_MONTH_CONFLICT:${requestedCycleMonth}:${actualCycleMonth}`,
    );
  }
  const openQuantity = commitments.reduce(
    (sum, row) => sum + row.openQuantity,
    0,
  );
  if (openQuantity > 0) {
    throw new Error(`CHINA_FORWARDER_COST_RECEIPT_OPEN:${openQuantity}`);
  }

  const draft = await loadInternalChinaDraftWithQuantityOverrides(
    await loadInternalChinaPurchaseDraft(draftId),
  );
  let reconciliation: InternalChinaReceiptCostReconciliation;
  try {
    reconciliation = await reconcileProductOnlyReceiptCosts(
      draft,
      actualCycleMonth,
    );
  } catch (error) {
    reconciliation = {
      matchedRows: 0,
      updatedRows: 0,
      productMasterSynced: false,
      productMasterError:
        error instanceof Error
          ? error.message
          : "PRODUCT_ONLY_RECEIPT_RECONCILIATION_FAILED",
    };
  }

  const now = new Date().toISOString();
  const summary = summaryFrom(
    draft,
    actualCycleMonth,
    actualCostKrw,
    now,
    reconciliation,
  );
  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=source_event_id,result_snapshot,updated_at`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          operation_type: INTERNAL_CHINA_FORWARDER_COST_OPERATION_TYPE,
          status: reconciliation.productMasterSynced ? "SUCCEEDED" : "PARTIAL",
          source: SOURCE,
          source_event_id: sourceEventId(draftId),
          correlation_id: correlationId(draftId),
          actor_type: "OPS_OPERATOR",
          input_snapshot: {
            draftId,
            cycleMonth: actualCycleMonth,
            actualCostKrw,
          },
          result_snapshot: summary,
          error_message: reconciliation.productMasterError,
          started_at: now,
          finished_at: now,
          updated_at: now,
        },
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `CHINA_FORWARDER_COST_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
  return summary;
}

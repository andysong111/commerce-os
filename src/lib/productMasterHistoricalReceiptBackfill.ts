const DEFAULT_PRODUCT_MASTER_URL =
  "https://commerce-os-product-master.vercel.app";

export type HistoricalReceiptBackfillMode = "diagnose" | "canary" | "apply";

export type HistoricalReceiptBackfillCandidate = {
  key: string;
  receiptId: string;
  batchId: number;
  externalId: string;
  occurredAt: string;
  barcode: string;
  skuId: string | null;
  skuCreatedAt: string | null;
  quantity: number;
  unitCostKrw: number;
  preProductMasterBaseline: boolean;
  status:
    | "SAFE_NEW"
    | "SAFE_REPAIR"
    | "ALREADY_PRESENT"
    | "OUTSIDE_MANAGED_BARCODE"
    | "CURRENT_SKU_NOT_FOUND"
    | "DUPLICATE_ACTIVE_SKU"
    | "EXISTING_LEDGER_CONFLICT";
  reason: string;
  movementId: string;
  receiptCostId: string;
};

export type HistoricalReceiptBackfillReport = {
  ok: boolean;
  sourceFingerprint: string;
  planFingerprint: string;
  generatedAt: string;
  summary: {
    events: number;
    items: number;
    managedItems: number;
    safeNew: number;
    safeRepair: number;
    alreadyPresent: number;
    outsideManagedBarcode: number;
    currentSkuNotFound: number;
    duplicateActiveSku: number;
    existingLedgerConflict: number;
    preProductMasterBaseline: number;
    postProductMasterBaseline: number;
    safeQuantity: number;
    safeReceiptCostKrwWeighted: number;
  };
  candidates: HistoricalReceiptBackfillCandidate[];
  blockers: HistoricalReceiptBackfillCandidate[];
  writesEnabled: false;
};

export type HistoricalReceiptBackfillResponse = {
  ok: boolean;
  mode: HistoricalReceiptBackfillMode;
  report?: HistoricalReceiptBackfillReport;
  selected?: number;
  writtenCosts?: number;
  writtenMovements?: number;
  idempotent?: boolean;
  sourceWritesEnabled?: boolean;
  businessWritesEnabled?: boolean;
  productMasterWritesEnabled?: boolean;
  writeScope?: string;
  error?: string;
  message?: string;
};

function connection() {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED");
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() || DEFAULT_PRODUCT_MASTER_URL
  ).replace(/\/$/, "");
  if (!/^https:\/\//.test(baseUrl)) {
    throw new Error("PRODUCT_MASTER_BASE_URL_INVALID");
  }
  return { baseUrl, secret };
}

export function productMasterHistoricalReceiptBackfillConfigured() {
  try {
    connection();
    return true;
  } catch {
    return false;
  }
}

export async function runProductMasterHistoricalReceiptBackfill({
  mode,
  snapshot,
  expectedPlanFingerprint,
}: {
  mode: HistoricalReceiptBackfillMode;
  snapshot: unknown;
  expectedPlanFingerprint?: string;
}): Promise<HistoricalReceiptBackfillResponse> {
  const { baseUrl, secret } = connection();
  const response = await fetch(
    `${baseUrl}/api/integrations/historical-confirmed-receipts`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-commerce-os-integration-secret": secret,
      },
      body: JSON.stringify({
        mode,
        snapshot,
        expectedPlanFingerprint: expectedPlanFingerprint || "",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as
    HistoricalReceiptBackfillResponse;
  if (!response.ok) {
    throw new Error(
      payload.message ||
        payload.error ||
        `PRODUCT_MASTER_HISTORICAL_RECEIPT_BACKFILL_FAILED:${response.status}`,
    );
  }
  return payload;
}

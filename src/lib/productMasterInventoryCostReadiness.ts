const DEFAULT_PRODUCT_MASTER_URL =
  "https://commerce-os-product-master.vercel.app";

export type ProductMasterInventoryCostRow = {
  skuId: string;
  barcode: string;
  inventoryQuantity: number;
  inventoryVerification: string;
  inventoryVerified: boolean;
  inventoryConfidence: string;
  inventoryRequiresReview: boolean;
  inventoryBaselineKind: string | null;
  initialZeroUnverified: boolean;
  movementCount: number;
  inboundMovementCount: number;
  receiptCostCount: number;
  hasConfirmedReceiptCost: boolean;
  latestConfirmedReceiptAt: string | null;
  latestConfirmedReceiptCostKrw: number;
  latestCostKrw: number;
  protectedCostKrw: number;
};

export type ProductMasterInventoryCostSummary = {
  managedActiveSkuCount: number;
  inventoryVerifiedCount: number;
  inventoryReviewCount: number;
  initialZeroUnverifiedCount: number;
  confirmedReceiptCostSkuCount: number;
  missingConfirmedReceiptCostSkuCount: number;
  inventoryMovementRowCount: number;
  receiptCostRowCount: number;
  movementKindCounts: Record<string, number>;
  movementSourceCounts: Record<string, number>;
  receiptSourceCounts: Record<string, number>;
};

export type ProductMasterInventoryCostReadiness = {
  generatedAt: string;
  mode: string;
  contentFingerprint: string;
  summary: ProductMasterInventoryCostSummary;
  rows: ProductMasterInventoryCostRow[];
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

export function productMasterInventoryCostReadinessConfigured() {
  try {
    connection();
    return true;
  } catch {
    return false;
  }
}

export async function loadProductMasterInventoryCostReadiness(): Promise<ProductMasterInventoryCostReadiness> {
  const { baseUrl, secret } = connection();
  const response = await fetch(
    `${baseUrl}/api/integrations/inventory-cost-ledger-snapshot`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-commerce-os-integration-secret": secret,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    generatedAt?: string;
    mode?: string;
    contentFingerprint?: string;
    summary?: ProductMasterInventoryCostSummary;
    rows?: ProductMasterInventoryCostRow[];
    message?: string;
    error?: string;
  };
  if (
    !response.ok ||
    payload.ok !== true ||
    !payload.summary ||
    !Array.isArray(payload.rows)
  ) {
    throw new Error(
      payload.message ||
        payload.error ||
        `PRODUCT_MASTER_INVENTORY_COST_SNAPSHOT_FAILED:${response.status}`,
    );
  }
  return {
    generatedAt: String(payload.generatedAt ?? ""),
    mode: String(payload.mode ?? ""),
    contentFingerprint: String(payload.contentFingerprint ?? ""),
    summary: payload.summary,
    rows: payload.rows,
  };
}

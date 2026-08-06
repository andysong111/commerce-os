const DEFAULT_PRODUCT_MASTER_URL =
  "https://commerce-os-product-master.vercel.app";

export type ProductMasterCatalogPhase =
  | "CATALOG_BLOCKED"
  | "CATALOG_REVIEW"
  | "READY_FOR_SHOPLING_SALES";

export type ProductMasterCatalogIssue = {
  skuId: string;
  barcode: string;
  modelNo: string;
  productName: string;
  optionName: string;
  severity: "BLOCKER" | "REVIEW";
  codes: string[];
  messages: string[];
};

export type ProductMasterCatalogReadiness = {
  generatedAt: string;
  mode: "SUPABASE" | "DEMO";
  summary: {
    phase: ProductMasterCatalogPhase;
    readyForShoplingSalesImport: boolean;
    totalSkuCount: number;
    activeSkuCount: number;
    uniqueBarcodeCount: number;
    duplicateBarcodeCount: number;
    identityReadyCount: number;
    listingMappedCount: number;
    listingMissingCount: number;
    invalidUnitsPerOrderCount: number;
    suspectedSetQuantityCount: number;
    duplicateListingIdentityCount: number;
    legacyModelCount: number;
    blankOptionCount: number;
    inventoryConfirmedCount: number;
    inventoryUnverifiedCount: number;
    salesCoveredCount: number;
    costCoveredCount: number;
    blockerSkuCount: number;
    reviewSkuCount: number;
    nextAction: string;
  };
  issues: ProductMasterCatalogIssue[];
};

function connection() {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED");
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() ||
    DEFAULT_PRODUCT_MASTER_URL
  ).replace(/\/$/, "");
  if (!/^https:\/\//.test(baseUrl)) {
    throw new Error("PRODUCT_MASTER_BASE_URL_INVALID");
  }
  return { baseUrl, secret };
}

export async function loadProductMasterCatalogReadiness(): Promise<ProductMasterCatalogReadiness> {
  const { baseUrl, secret } = connection();
  const response = await fetch(
    `${baseUrl}/api/integrations/catalog-readiness`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-commerce-os-integration-secret": secret,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Partial<
    ProductMasterCatalogReadiness
  > & {
    ok?: boolean;
    message?: string;
    error?: string;
  };
  if (
    !response.ok ||
    payload.ok !== true ||
    !payload.summary ||
    !Array.isArray(payload.issues)
  ) {
    throw new Error(
      payload.message ||
        payload.error ||
        `PRODUCT_MASTER_CATALOG_READINESS_FAILED:${response.status}`,
    );
  }
  return {
    generatedAt: String(payload.generatedAt ?? ""),
    mode: payload.mode === "DEMO" ? "DEMO" : "SUPABASE",
    summary: payload.summary,
    issues: payload.issues,
  };
}

export function productMasterCatalogReadinessConfigured() {
  return Boolean(process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim());
}

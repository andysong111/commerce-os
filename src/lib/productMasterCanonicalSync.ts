import {
  buildProductMasterSnapshotFromTrackerState,
  type ProductMasterSnapshotPayload,
} from "@/lib/productMasterSync";

type R = Record<string, unknown>;
type StableSku = ProductMasterSnapshotPayload["skus"][number] & {
  sourceSystem: string;
  sourceSkuKey: string;
};

type CanonicalPayload = Omit<ProductMasterSnapshotPayload, "skus"> & {
  skus: StableSku[];
};

const PRODUCT_MASTER_URL = "https://commerce-os-product-master.vercel.app";
const SOURCE_SYSTEM = "ops_product_launch_tracker";
const BATCH_SIZE = 500;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function object(value: unknown): R {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as R)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalized(value: unknown) {
  return text(value).normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

function stableSkuId(sourceSkuKey: string) {
  return `sku-source:${encodeURIComponent(`${SOURCE_SYSTEM}:${sourceSkuKey}`)}`;
}

function fallbackOptionIdentity(value: unknown, index: number) {
  const normalizedName = normalized(value);
  return normalizedName ? `legacy-name:${normalizedName}` : `legacy-index:${index + 1}`;
}

function trackerOptions(item: R): R[] {
  const current = list(item.orderOptions).map(object);
  if (current.length) return current;
  const legacy = list(item.options).map((value, index) => ({
    id: fallbackOptionIdentity(value, index),
    saleOption: text(value),
  }));
  if (legacy.length) return legacy;
  return [
    {
      id: "default",
      saleOption: "단품",
      barcode: item.barcode || item.warehouseLocation,
    },
  ];
}

export function buildCanonicalProductMasterSnapshot(input: unknown) {
  const built = buildProductMasterSnapshotFromTrackerState(input);
  const state = object(input);
  const identityByBarcode = new Map<
    string,
    { sourceSkuKey: string; skuId: string }
  >();

  for (const rawItem of list(state.items)) {
    const item = object(rawItem);
    const itemId = text(item.id) || `model:${normalized(item.modelNumber)}`;
    const options = trackerOptions(item);
    const rowBarcode = normalized(item.barcode || item.warehouseLocation);
    for (const [index, rawOption] of options.entries()) {
      const option = object(rawOption);
      const barcode =
        normalized(option.barcode) || (options.length === 1 ? rowBarcode : "");
      if (!barcode) continue;
      const optionId =
        text(option.id) ||
        fallbackOptionIdentity(option.saleOption || option.optionName, index);
      const sourceSkuKey = `${itemId}:${optionId}`;
      const existing = identityByBarcode.get(barcode);
      if (existing && existing.sourceSkuKey !== sourceSkuKey) {
        throw new Error(
          `TRACKER_BARCODE_CONFLICT:${barcode}:${existing.sourceSkuKey}:${sourceSkuKey}`,
        );
      }
      identityByBarcode.set(barcode, {
        sourceSkuKey,
        skuId: stableSkuId(sourceSkuKey),
      });
    }
  }

  const skuIdMap = new Map<string, string>();
  const skus: StableSku[] = built.payload.skus.map((sku) => {
    const identity = identityByBarcode.get(normalized(sku.barcode));
    const sourceSkuKey =
      identity?.sourceSkuKey ||
      `fallback:${sku.productId}:${normalized(sku.optionName) || "DEFAULT"}`;
    const nextId = identity?.skuId || stableSkuId(sourceSkuKey);
    skuIdMap.set(sku.id, nextId);
    return {
      ...sku,
      id: nextId,
      sourceSystem: SOURCE_SYSTEM,
      sourceSkuKey,
    };
  });

  const remapSkuId = <T extends { skuId: string }>(row: T): T => ({
    ...row,
    skuId: skuIdMap.get(row.skuId) || row.skuId,
  });

  const payload: CanonicalPayload = {
    ...built.payload,
    skus,
    listingMappings: built.payload.listingMappings.map(remapSkuId),
    receiptCosts: built.payload.receiptCosts.map(remapSkuId),
  };
  return { payload, skipped: built.skipped };
}

export async function pushCanonicalProductMasterSnapshotFromTrackerState(
  input: unknown,
) {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_MISSING");
  const baseUrl = (process.env.PRODUCT_MASTER_BASE_URL || PRODUCT_MASTER_URL)
    .trim()
    .replace(/\/$/, "");
  const built = buildCanonicalProductMasterSnapshot(input);
  const counts: Record<string, number> = {};
  const groups: Array<[keyof CanonicalPayload, unknown[]]> = [
    ["products", built.payload.products],
    ["skus", built.payload.skus],
    ["listingMappings", built.payload.listingMappings],
    ["receiptCosts", built.payload.receiptCosts],
  ];

  for (const [key, rows] of groups) {
    counts[key] = 0;
    for (let index = 0; index < rows.length; index += BATCH_SIZE) {
      const batch = rows.slice(index, index + BATCH_SIZE);
      const response = await fetch(
        `${baseUrl}/api/integrations/canonical-snapshot`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-commerce-os-integration-secret": secret,
          },
          body: JSON.stringify({ [key]: batch }),
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        },
      );
      const body = await read(response);
      if (!response.ok) {
        throw new Error(
          `PRODUCT_MASTER_CANONICAL_SYNC_FAILED:${key}:${response.status}:${message(body)}`,
        );
      }
      counts[key] += batch.length;
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const remoteCounts = object(body).counts;
        if (remoteCounts && typeof remoteCounts === "object" && !Array.isArray(remoteCounts)) {
          counts.skuBarcodeChanges =
            Number(counts.skuBarcodeChanges || 0) +
            Number(object(remoteCounts).sku_barcode_history || 0);
        }
      }
    }
  }

  return {
    baseUrl,
    counts,
    skipped: built.skipped,
    total: groups.reduce((sum, [, rows]) => sum + rows.length, 0),
  };
}

async function read(response: Response) {
  const body = await response.text();
  if (!body) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

function message(value: unknown) {
  const row = object(value);
  return text(row.message) || text(row.error) || text(value) || "unknown error";
}

type UnknownRecord = Record<string, unknown>;

type ProductMasterProduct = {
  id: string;
  modelNo: string;
  productNameKo: string;
  productNameCn?: string | null;
  category?: string | null;
  status: "LAUNCHING" | "ACTIVE" | "PAUSED" | "DISCONTINUED";
  mainImageUrl?: string | null;
  origin: string;
  hsCode?: string | null;
  isSeasonal: boolean;
  isStrategic: boolean;
  memo?: string | null;
};

type ProductMasterSku = {
  id: string;
  productId: string;
  barcode: string;
  optionName: string;
  chinaOptionName?: string | null;
  optionImageUrl?: string | null;
  labelText?: string | null;
  packagingGrade: number;
  moq: number;
  cartonQuantity: number;
  supplierUrl?: string | null;
  leadTimeDays: number;
  targetStockDays: number;
  memo?: string | null;
  active: boolean;
};

type ProductMasterListing = {
  id: string;
  skuId: string;
  goodsKey?: string | null;
  optionId?: string | null;
  channel?: string | null;
  listingName?: string | null;
  listingOptionName?: string | null;
  unitsPerOrder: number;
  active: boolean;
  syncedAt?: string | null;
};

type ProductMasterReceiptCost = {
  id: string;
  skuId: string;
  quantity: number;
  unitCostKrw: number;
  receivedAt: string;
  source: string;
  externalId?: string | null;
};

export type ProductMasterSnapshotPayload = {
  products: ProductMasterProduct[];
  skus: ProductMasterSku[];
  listingMappings: ProductMasterListing[];
  inventoryMovements: never[];
  salesMonthly: never[];
  receiptCosts: ProductMasterReceiptCost[];
  decisions: never[];
};

export type ProductMasterSyncBuildResult = {
  payload: ProductMasterSnapshotPayload;
  skipped: {
    missingModelNumber: number;
    missingBarcode: number;
    receiptWithoutSku: number;
  };
};

const DEFAULT_PRODUCT_MASTER_URL =
  "https://commerce-os-product-master.vercel.app";
const CHANNEL_LABELS: Record<string, string> = {
  wholesale1: "도매1",
  wholesale2: "도매2",
  wholesale3: "도매3",
  wholesale4: "도매4",
  retail1: "소매1",
  retail2: "소매2",
};
const COMPLETED_STAGE_STATUSES = new Set(["완료", "제외"]);
const MAX_BATCH_SIZE = 500;

export function buildProductMasterSnapshotFromTrackerState(
  input: unknown,
): ProductMasterSyncBuildResult {
  const state = record(input);
  const items = array(state.items).map(record);
  const products = new Map<string, ProductMasterProduct>();
  const skus = new Map<string, ProductMasterSku>();
  const listingMappings = new Map<string, ProductMasterListing>();
  const skipped = {
    missingModelNumber: 0,
    missingBarcode: 0,
    receiptWithoutSku: 0,
  };

  for (const item of items) {
    const modelNo = normalizeModelNumber(item.modelNumber);
    const productName = text(item.productName);
    if (!modelNo) {
      skipped.missingModelNumber += 1;
      continue;
    }

    const productId = stableId("product", modelNo);
    const archived = Boolean(item.archivedAt);
    const status = productStatus(item, archived);
    const image = record(item.detailPageAsset);
    const supplierUrl = primarySupplierUrl(item);
    products.set(productId, {
      id: productId,
      modelNo,
      productNameKo: productName || modelNo,
      productNameCn: nullableText(item.productNameCn),
      category: nullableText(item.shoplingCategory),
      status,
      mainImageUrl: nullableText(image.mainImageUrl),
      origin: "MADE IN CHINA",
      hsCode: nullableText(item.hsCode),
      isSeasonal: Boolean(item.isSeasonal),
      isStrategic: Boolean(item.isStrategic),
      memo: nullableText(item.notes),
    });

    const orderOptions = normalizedOrderOptions(item);
    const rowBarcode = normalizeBarcode(item.barcode || item.warehouseLocation);
    for (let index = 0; index < orderOptions.length; index += 1) {
      const option = orderOptions[index];
      const barcode =
        normalizeBarcode(option.barcode) ||
        (orderOptions.length === 1 ? rowBarcode : "");
      if (!barcode) {
        skipped.missingBarcode += 1;
        continue;
      }
      const skuId = stableId("sku", barcode);
      const optionName = text(option.saleOption) || text(option.optionName) || "단품";
      skus.set(skuId, {
        id: skuId,
        productId,
        barcode,
        optionName,
        chinaOptionName: nullableText(option.chinaOption),
        optionImageUrl: nullableText(option.optionImageUrl),
        labelText: nullableText(item.labelText),
        packagingGrade: boundedInteger(item.packagingGrade, 1, 5, 3),
        moq: positiveInteger(option.moq ?? item.moq, 1),
        cartonQuantity: positiveInteger(
          option.cartonQuantity ?? item.cartonQuantity,
          1,
        ),
        supplierUrl: supplierUrl || null,
        leadTimeDays: nonNegativeInteger(item.leadTimeDays, 14),
        targetStockDays: nonNegativeInteger(item.targetStockDays, 30),
        memo: nullableText(item.notes),
        active: !archived,
      });

      const shoplingProducts = record(item.shoplingProducts);
      for (const [channelKey, channelLabel] of Object.entries(CHANNEL_LABELS)) {
        const channel = record(shoplingProducts[channelKey]);
        const goodsKey = text(channel.goodsKey);
        if (!goodsKey) continue;
        const mappingId = stableId(
          "listing",
          `${barcode}:${channelKey}:${goodsKey}`,
        );
        listingMappings.set(mappingId, {
          id: mappingId,
          skuId,
          goodsKey,
          optionId: nullableText(option.optionId),
          channel: channelLabel,
          listingName: productName || modelNo,
          listingOptionName: optionName,
          unitsPerOrder: inferUnitsPerOrder(optionName),
          active: !archived,
          syncedAt:
            validIso(channel.registeredAt) ||
            validIso(item.updatedAt) ||
            new Date().toISOString(),
        });
      }
    }
  }

  const receiptCosts: ProductMasterReceiptCost[] = [];
  const receiptCache = record(state.priceAdjustmentReceiptCache);
  const receiptsByBarcode = record(receiptCache.receiptsByBarcode);
  const skuByBarcode = new Map(
    [...skus.values()].map((sku) => [normalizeBarcode(sku.barcode), sku]),
  );
  for (const [rawBarcode, rawRows] of Object.entries(receiptsByBarcode)) {
    const barcode = normalizeBarcode(rawBarcode);
    const sku = skuByBarcode.get(barcode);
    if (!sku) {
      skipped.receiptWithoutSku += array(rawRows).length;
      continue;
    }
    for (const rawRow of array(rawRows)) {
      const row = record(rawRow);
      const sourceId = text(row.id) || text(row.externalId);
      const receivedAt = validIso(row.receivedAt);
      const unitCostKrw = nonNegativeInteger(row.unitCostKrw, 0);
      if (!sourceId || !receivedAt || unitCostKrw <= 0) continue;
      receiptCosts.push({
        id: stableId("receipt", sourceId),
        skuId: sku.id,
        quantity: nonNegativeNumber(row.quantity, 0),
        unitCostKrw,
        receivedAt,
        source: "ops_center_confirmed_receipt_cache",
        externalId: sourceId,
      });
    }
  }

  return {
    payload: {
      products: [...products.values()],
      skus: [...skus.values()],
      listingMappings: [...listingMappings.values()],
      inventoryMovements: [],
      salesMonthly: [],
      receiptCosts,
      decisions: [],
    },
    skipped,
  };
}

export async function pushProductMasterSnapshotFromTrackerState(input: unknown) {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_MISSING");
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL || DEFAULT_PRODUCT_MASTER_URL
  )
    .trim()
    .replace(/\/$/, "");
  const built = buildProductMasterSnapshotFromTrackerState(input);
  const counts: Record<string, number> = {};
  const orderedEntries: Array<
    [keyof ProductMasterSnapshotPayload, unknown[]]
  > = [
    ["products", built.payload.products],
    ["skus", built.payload.skus],
    ["listingMappings", built.payload.listingMappings],
    ["receiptCosts", built.payload.receiptCosts],
  ];

  for (const [key, rows] of orderedEntries) {
    counts[key] = 0;
    for (let index = 0; index < rows.length; index += MAX_BATCH_SIZE) {
      const batch = rows.slice(index, index + MAX_BATCH_SIZE);
      const response = await fetch(`${baseUrl}/api/integrations/snapshots`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-commerce-os-integration-secret": secret,
        },
        body: JSON.stringify({ [key]: batch }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      const body = await readResponse(response);
      if (!response.ok) {
        throw new Error(
          `PRODUCT_MASTER_SYNC_FAILED:${key}:${response.status}:${errorText(body)}`,
        );
      }
      counts[key] += batch.length;
    }
  }

  return {
    baseUrl,
    counts,
    skipped: built.skipped,
    total:
      built.payload.products.length +
      built.payload.skus.length +
      built.payload.listingMappings.length +
      built.payload.receiptCosts.length,
  };
}

export function inferUnitsPerOrder(value: unknown) {
  const optionName = text(value).normalize("NFKC");
  if (!optionName) return 1;
  if (/(^|[\s,/+_-])(단품|낱개|1\s*개)(?=$|[\s,/+_-])/i.test(optionName)) {
    return 1;
  }
  const direct = optionName.match(
    /(?:^|[\s,/+_-])(\d{1,4})\s*(개|매|입|P|PCS|EA)\s*(?:세트|SET|묶음|팩|PACK|포장|구성|들이)?(?=$|[\s,/+_-])/i,
  );
  if (direct) return boundedInteger(direct[1], 1, 10_000, 1);
  const attached = optionName.match(
    /(\d{1,4})\s*(개|매|입|P|PCS|EA)\s*(세트|SET|묶음|팩|PACK|포장|구성|들이)/i,
  );
  if (attached) return boundedInteger(attached[1], 1, 10_000, 1);
  const prefixed = optionName.match(
    /(?:세트|SET|묶음|팩|PACK|포장|구성)\s*(\d{1,4})\s*(?:개|매|입|P|PCS|EA)?/i,
  );
  return prefixed ? boundedInteger(prefixed[1], 1, 10_000, 1) : 1;
}

function normalizedOrderOptions(item: UnknownRecord) {
  const options = array(item.orderOptions).map(record);
  if (options.length) return options;
  const legacy = array(item.options).map((value, index) => ({
    id: `legacy-${index + 1}`,
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

function productStatus(
  item: UnknownRecord,
  archived: boolean,
): ProductMasterProduct["status"] {
  if (archived) return "PAUSED";
  const stages = record(item.stages);
  const values = Object.values(stages).map((value) =>
    text(record(value).status),
  );
  return values.length > 0 && values.every((value) => COMPLETED_STAGE_STATUSES.has(value))
    ? "ACTIVE"
    : "LAUNCHING";
}

function primarySupplierUrl(item: UnknownRecord) {
  const primary = text(item.primaryChinaProductLink);
  if (primary) return primary;
  const links = array(item.chinaProductLinks).map(text).filter(Boolean);
  if (links[0]) return links[0];
  const source = record(item.detailPageSource);
  return text(source.primaryUrl) || null;
}

function normalizeModelNumber(value: unknown) {
  return text(value).normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

function normalizeBarcode(value: unknown) {
  return text(value).normalize("NFKC").toUpperCase();
}

function stableId(prefix: string, value: string) {
  return `${prefix}:${encodeURIComponent(value.normalize("NFKC").trim().toUpperCase())}`;
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function nullableText(value: unknown) {
  const result = text(value);
  return result || null;
}

function positiveInteger(value: unknown, fallback: number) {
  const result = Math.round(Number(value));
  return Number.isFinite(result) && result >= 1 ? result : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number) {
  const result = Math.round(Number(value));
  return Number.isFinite(result) && result >= 0 ? result : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number) {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : fallback;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  const result = Math.round(Number(value));
  return Number.isFinite(result) && result >= minimum && result <= maximum
    ? result
    : fallback;
}

function validIso(value: unknown) {
  const result = text(value);
  return result && Number.isFinite(Date.parse(result)) ? result : null;
}

async function readResponse(response: Response) {
  const textBody = await response.text();
  if (!textBody) return null;
  try {
    return JSON.parse(textBody) as unknown;
  } catch {
    return textBody;
  }
}

function errorText(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as { message?: unknown; error?: unknown };
    return text(candidate.message) || text(candidate.error) || "unknown error";
  }
  return text(value) || "unknown error";
}

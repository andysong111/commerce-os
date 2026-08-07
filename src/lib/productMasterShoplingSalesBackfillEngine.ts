import {
  normalizeShoplingBarcode,
  normalizeShoplingOrder,
  type ShoplingRawRow,
} from "@/lib/shopling/shoplingNormalize";
import type { ShoplingDateRange } from "@/lib/shopling/shoplingReadClient";
import type { ProductPlanningSnapshot } from "@/lib/shopling/shoplingLiveAggregation";

export type ProductMasterSalesMonthlyRow = {
  id: string;
  barcode: string;
  month: string;
  quantity: number;
  revenue: number;
  lastSaleAt: string | null;
  source: "shopling_orders_24m_v1";
};

export type ProductMasterSalesUnmappedSample = {
  orderLineId: string;
  orderNo: string;
  orderedAt: string;
  optionId: string | null;
  productId: string | null;
  mallProductKey: string | null;
  managedCode: string | null;
  status: string;
};

export type ProductMasterShoplingSalesChunk = {
  range: ShoplingDateRange;
  fetchedRows: number;
  acceptedRows: number;
  ignoredRows: number;
  unmappedRows: number;
  duplicateRows: number;
  totalBaseUnits: number;
  totalRevenue: number;
  monthlyRows: ProductMasterSalesMonthlyRow[];
  unmappedSamples: ProductMasterSalesUnmappedSample[];
};

type ListingIdentity = {
  barcode: string;
  unitsPerOrder: number;
};

type PlanningIndex = {
  products: Set<string>;
  byOptionId: Map<string, ListingIdentity>;
  byGoodsKey: Map<string, ListingIdentity>;
  byBarcode: Map<string, ListingIdentity>;
  managedOptionIds: Set<string>;
};

const MANAGED_BARCODE = /^B[A-Z]{2}\d+-\d+$/;
const STRUCTURED_LEGACY_CODE = /^[A-Z]{3}\d+-\d+$/;
const MAX_UNMAPPED_SAMPLES = 50;

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedStructuredCode(value: unknown) {
  const barcode = normalizeShoplingBarcode(value);
  return STRUCTURED_LEGACY_CODE.test(barcode) ? barcode : "";
}

function managedBarcode(value: unknown) {
  const barcode = normalizeShoplingBarcode(value);
  return MANAGED_BARCODE.test(barcode) ? barcode : "";
}

function validIso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function validSaleStatus(status: string) {
  const normalized = status.toLowerCase();
  return !["취소", "반품", "환불", "cancel", "return", "refund"].some(
    (keyword) => normalized.includes(keyword),
  );
}

function safeUnits(value: unknown) {
  const parsed = Math.round(number(value));
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function registerUnique(
  target: Map<string, ListingIdentity>,
  ambiguous: Set<string>,
  key: string,
  value: ListingIdentity,
) {
  if (!key || ambiguous.has(key)) return;
  const existing = target.get(key);
  if (!existing) {
    target.set(key, value);
    return;
  }
  if (
    existing.barcode !== value.barcode ||
    existing.unitsPerOrder !== value.unitsPerOrder
  ) {
    target.delete(key);
    ambiguous.add(key);
  }
}

function buildPlanningIndex(planning: ProductPlanningSnapshot): PlanningIndex {
  const products = new Set<string>();
  const byOptionId = new Map<string, ListingIdentity>();
  const byGoodsKey = new Map<string, ListingIdentity>();
  const ambiguousOptionIds = new Set<string>();
  const ambiguousGoodsKeys = new Set<string>();
  const unitsByBarcode = new Map<string, Set<number>>();
  const managedOptionIds = new Set<string>();

  for (const product of planning.products ?? []) {
    const barcode = managedBarcode(product.barcode);
    if (!barcode || product.skuActive === false) continue;
    products.add(barcode);
    const activeListings = (product.listings ?? []).filter(
      (listing) => listing.active !== false,
    );
    if (!activeListings.length) {
      unitsByBarcode.set(barcode, new Set([1]));
      continue;
    }
    for (const listing of activeListings) {
      const optionId = text(listing.optionId);
      const goodsKey = text(listing.goodsKey);
      if (optionId) managedOptionIds.add(optionId);
      const identity = {
        barcode,
        unitsPerOrder: safeUnits(listing.unitsPerOrder),
      };
      registerUnique(
        byOptionId,
        ambiguousOptionIds,
        optionId,
        identity,
      );
      registerUnique(
        byGoodsKey,
        ambiguousGoodsKeys,
        goodsKey,
        identity,
      );
      const units = unitsByBarcode.get(barcode) ?? new Set<number>();
      units.add(identity.unitsPerOrder);
      unitsByBarcode.set(barcode, units);
    }
  }

  const byBarcode = new Map<string, ListingIdentity>();
  for (const [barcode, units] of unitsByBarcode) {
    if (units.size !== 1) continue;
    byBarcode.set(barcode, {
      barcode,
      unitsPerOrder: [...units][0] ?? 1,
    });
  }
  return {
    products,
    byOptionId,
    byGoodsKey,
    byBarcode,
    managedOptionIds,
  };
}

function rawValue(row: ShoplingRawRow, keys: string[]) {
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined && direct !== null && direct !== "") {
      return text(direct);
    }
    const match = Object.keys(row).find(
      (candidate) => candidate.toLowerCase() === key.toLowerCase(),
    );
    if (match && row[match] !== undefined && row[match] !== null) {
      return text(row[match]);
    }
  }
  return "";
}

function rawStructuredCode(row: ShoplingRawRow) {
  for (const key of [
    "ptn_goods_cd",
    "buying_cd",
    "mall_ptn_goods_cd",
    "mall_opt_cd",
    "opt_barcode",
    "barcode",
  ]) {
    const code = normalizedStructuredCode(rawValue(row, [key]));
    if (code) return code;
  }
  return "";
}

function rawManagedCode(row: ShoplingRawRow) {
  const structured = rawStructuredCode(row);
  return managedBarcode(structured);
}

function isManagedSalesScope(
  index: PlanningIndex,
  order: ReturnType<typeof normalizeShoplingOrder>,
  raw: ShoplingRawRow,
) {
  const rawCode = rawStructuredCode(raw) || normalizedStructuredCode(order.barcode);
  if (rawCode) return Boolean(managedBarcode(rawCode));

  const optionId = text(order.optionId);
  if (optionId && index.managedOptionIds.has(optionId)) return true;

  for (const key of [text(order.productId), text(order.mallProductKey)]) {
    if (key && index.byGoodsKey.has(key)) return true;
  }
  return false;
}

function resolveIdentity(
  index: PlanningIndex,
  order: ReturnType<typeof normalizeShoplingOrder>,
  raw: ShoplingRawRow,
) {
  const optionId = text(order.optionId);
  if (optionId && index.byOptionId.has(optionId)) {
    return index.byOptionId.get(optionId)!;
  }

  const directCode = rawManagedCode(raw) || managedBarcode(order.barcode);
  if (directCode && index.byBarcode.has(directCode)) {
    return index.byBarcode.get(directCode)!;
  }

  for (const key of [text(order.productId), text(order.mallProductKey)]) {
    if (key && index.byGoodsKey.has(key)) return index.byGoodsKey.get(key)!;
  }
  return null;
}

function inDateRange(iso: string, range: ShoplingDateRange) {
  const date = iso.slice(0, 10);
  return date >= range.start && date <= range.end;
}

function monthlyId(barcode: string, month: string) {
  return `shopling-sales-v1:${barcode}:${month}`;
}

export function aggregateProductMasterShoplingSalesChunk(
  rows: ShoplingRawRow[],
  planning: ProductPlanningSnapshot,
  range: ShoplingDateRange,
): ProductMasterShoplingSalesChunk {
  const index = buildPlanningIndex(planning);
  const seen = new Set<string>();
  const monthly = new Map<
    string,
    {
      barcode: string;
      month: string;
      quantity: number;
      revenue: number;
      lastSaleAt: string | null;
    }
  >();
  const unmappedSamples: ProductMasterSalesUnmappedSample[] = [];
  let acceptedRows = 0;
  let ignoredRows = 0;
  let unmappedRows = 0;
  let duplicateRows = 0;

  for (const raw of rows) {
    const order = normalizeShoplingOrder(raw);
    if (!order.id || seen.has(order.id)) {
      duplicateRows += 1;
      continue;
    }
    seen.add(order.id);
    const orderedAt = validIso(order.orderedAt);
    const quantity = Math.max(0, Math.round(number(order.quantity)));
    if (
      !order.orderNo ||
      !orderedAt ||
      !inDateRange(orderedAt, range) ||
      !validSaleStatus(order.status) ||
      quantity <= 0
    ) {
      ignoredRows += 1;
      continue;
    }

    // Canonical sales are limited to the current warehouse location-code
    // catalog (BAA1-1, BEC4-2, ...). A structured non-B code such as AAA385-2
    // is explicit legacy evidence and is excluded even when its goods_key was
    // later reused by a managed product. Historical rows without a code are
    // accepted only when the current optionId or a uniquely resolvable
    // goods_key proves a current B-prefixed managed SKU.
    if (!isManagedSalesScope(index, order, raw)) {
      ignoredRows += 1;
      continue;
    }

    const identity = resolveIdentity(index, order, raw);
    if (!identity || !index.products.has(identity.barcode)) {
      unmappedRows += 1;
      if (unmappedSamples.length < MAX_UNMAPPED_SAMPLES) {
        unmappedSamples.push({
          orderLineId: order.id,
          orderNo: order.orderNo,
          orderedAt,
          optionId: order.optionId || null,
          productId: order.productId,
          mallProductKey: order.mallProductKey,
          managedCode: rawManagedCode(raw) || null,
          status: order.status,
        });
      }
      continue;
    }

    acceptedRows += 1;
    const month = orderedAt.slice(0, 7);
    const key = `${identity.barcode}\u0000${month}`;
    const current = monthly.get(key) ?? {
      barcode: identity.barcode,
      month,
      quantity: 0,
      revenue: 0,
      lastSaleAt: null,
    };
    current.quantity += quantity * identity.unitsPerOrder;
    current.revenue += Math.max(0, number(order.paidAmount));
    if (!current.lastSaleAt || orderedAt > current.lastSaleAt) {
      current.lastSaleAt = orderedAt;
    }
    monthly.set(key, current);
  }

  const monthlyRows = [...monthly.values()]
    .map((row) => ({
      id: monthlyId(row.barcode, row.month),
      barcode: row.barcode,
      month: row.month,
      quantity: row.quantity,
      revenue: Math.round(row.revenue),
      lastSaleAt: row.lastSaleAt,
      source: "shopling_orders_24m_v1" as const,
    }))
    .sort((left, right) =>
      `${left.month}\u0000${left.barcode}`.localeCompare(
        `${right.month}\u0000${right.barcode}`,
      ),
    );

  return {
    range,
    fetchedRows: rows.length,
    acceptedRows,
    ignoredRows,
    unmappedRows,
    duplicateRows,
    totalBaseUnits: monthlyRows.reduce((sum, row) => sum + row.quantity, 0),
    totalRevenue: monthlyRows.reduce((sum, row) => sum + row.revenue, 0),
    monthlyRows,
    unmappedSamples,
  };
}

export function combineProductMasterShoplingSalesChunks(
  chunks: ProductMasterShoplingSalesChunk[],
) {
  const monthly = new Map<string, ProductMasterSalesMonthlyRow>();
  const sampleKeys = new Set<string>();
  const unmappedSamples: ProductMasterSalesUnmappedSample[] = [];

  for (const chunk of chunks) {
    for (const row of chunk.monthlyRows) {
      const key = `${row.barcode}\u0000${row.month}`;
      const current = monthly.get(key);
      if (!current) {
        monthly.set(key, { ...row });
      } else {
        current.quantity += row.quantity;
        current.revenue += row.revenue;
        if (
          row.lastSaleAt &&
          (!current.lastSaleAt || row.lastSaleAt > current.lastSaleAt)
        ) {
          current.lastSaleAt = row.lastSaleAt;
        }
      }
    }
    for (const sample of chunk.unmappedSamples) {
      if (sampleKeys.has(sample.orderLineId) || unmappedSamples.length >= 100) {
        continue;
      }
      sampleKeys.add(sample.orderLineId);
      unmappedSamples.push(sample);
    }
  }

  const rows = [...monthly.values()].sort((left, right) =>
    `${left.month}\u0000${left.barcode}`.localeCompare(
      `${right.month}\u0000${right.barcode}`,
    ),
  );
  return {
    fetchedRows: chunks.reduce((sum, chunk) => sum + chunk.fetchedRows, 0),
    acceptedRows: chunks.reduce((sum, chunk) => sum + chunk.acceptedRows, 0),
    ignoredRows: chunks.reduce((sum, chunk) => sum + chunk.ignoredRows, 0),
    unmappedRows: chunks.reduce((sum, chunk) => sum + chunk.unmappedRows, 0),
    duplicateRows: chunks.reduce((sum, chunk) => sum + chunk.duplicateRows, 0),
    totalBaseUnits: rows.reduce((sum, row) => sum + row.quantity, 0),
    totalRevenue: rows.reduce((sum, row) => sum + row.revenue, 0),
    monthlyRowCount: rows.length,
    barcodeCount: new Set(rows.map((row) => row.barcode)).size,
    months: [...new Set(rows.map((row) => row.month))].sort(),
    rows,
    unmappedSamples,
  };
}

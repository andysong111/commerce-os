import { recordCommerceDataSourceHealth } from "@/lib/commerceDataSourceHealth";
import { temporaryOpsIdentity } from "@/lib/opsLoginBypass";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";

export const PRICE_ADJUSTMENT_SALES_CACHE_KEY = "priceAdjustmentSalesCache";
export const MAX_SALES_CACHE_PRODUCTS = 25_000;

export type PriceAdjustmentSalesMonth = {
  month: string;
  quantity: number;
  revenue: number;
};

export type PriceAdjustmentSalesProduct = {
  barcode: string;
  name: string;
  modelNumber: string | null;
  goodsKeys: string[];
  active: boolean;
  unitCost: number;
  lastSaleAt: string | null;
  historyStart: string | null;
  months: PriceAdjustmentSalesMonth[];
};

export type PriceAdjustmentSalesCache = {
  snapshotId: string;
  generatedAt: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  complete: boolean;
  productCount: number;
  updatedAt: string;
  productsByBarcode: Record<string, PriceAdjustmentSalesProduct>;
};

type TrackerState = Record<string, unknown> & {
  schemaVersion?: unknown;
  items?: unknown;
  [PRICE_ADJUSTMENT_SALES_CACHE_KEY]?: unknown;
};

export async function mergePriceAdjustmentSalesCachePage(input: {
  snapshotId: string;
  generatedAt: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  complete: boolean;
  products: PriceAdjustmentSalesProduct[];
}) {
  const config = getProductLaunchAdminConfig();
  if (!config.ok) {
    throw new Error(config.body.message);
  }
  const identity = temporaryOpsIdentity();
  const stored = await readProductLaunchState(config.value, identity.userId);
  const state = normalizeTrackerState(stored?.state_payload);
  const current = normalizeCache(state[PRICE_ADJUSTMENT_SALES_CACHE_KEY]);
  const cache =
    current?.snapshotId === input.snapshotId
      ? structuredClone(current)
      : createEmptyCache(input.snapshotId, input.generatedAt);

  for (const product of input.products) {
    cache.productsByBarcode[product.barcode] = product;
  }
  const productCount = Object.keys(cache.productsByBarcode).length;
  if (productCount > MAX_SALES_CACHE_PRODUCTS) {
    throw new Error(
      `가격조정 판매추이 캐시는 최대 ${MAX_SALES_CACHE_PRODUCTS.toLocaleString("ko-KR")}개 상품까지 저장할 수 있습니다.`,
    );
  }

  cache.generatedAt = input.generatedAt;
  cache.coverageStart = earlier(cache.coverageStart, input.coverageStart);
  cache.coverageEnd = later(cache.coverageEnd, input.coverageEnd);
  cache.complete = input.complete;
  cache.productCount = productCount;
  cache.updatedAt = new Date().toISOString();

  const nextState: TrackerState = {
    ...state,
    schemaVersion: Math.max(3, Math.floor(Number(state.schemaVersion) || 3)),
    [PRICE_ADJUSTMENT_SALES_CACHE_KEY]: cache,
  };
  await writeProductLaunchState(config.value, identity, nextState);

  if (cache.complete) {
    await recordCommerceDataSourceHealth({
      sourceKey: "sales_orders",
      status: salesCacheFresh(cache.generatedAt) ? "FRESH" : "STALE",
      generatedAt: cache.generatedAt,
      maxAgeMinutes: 24 * 60,
      details: {
        snapshotId: cache.snapshotId,
        productCount: cache.productCount,
        coverageStart: cache.coverageStart,
        coverageEnd: cache.coverageEnd,
      },
    }).catch(() => undefined);
  }

  return cache;
}

export async function readPriceAdjustmentSalesCache() {
  const config = getProductLaunchAdminConfig();
  if (!config.ok) {
    throw new Error(config.body.message);
  }
  const identity = temporaryOpsIdentity();
  const stored = await readProductLaunchState(config.value, identity.userId);
  const state = normalizeTrackerState(stored?.state_payload);
  return normalizeCache(state[PRICE_ADJUSTMENT_SALES_CACHE_KEY]);
}

function createEmptyCache(
  snapshotId: string,
  generatedAt: string,
): PriceAdjustmentSalesCache {
  return {
    snapshotId,
    generatedAt,
    coverageStart: null,
    coverageEnd: null,
    complete: false,
    productCount: 0,
    updatedAt: new Date().toISOString(),
    productsByBarcode: {},
  };
}

function normalizeTrackerState(value: unknown): TrackerState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { schemaVersion: 3, items: [] };
  }
  const state = structuredClone(value) as TrackerState;
  if (!Array.isArray(state.items)) state.items = [];
  return state;
}

function normalizeCache(value: unknown): PriceAdjustmentSalesCache | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<PriceAdjustmentSalesCache>;
  const snapshotId = text(raw.snapshotId);
  const generatedAt = validIso(raw.generatedAt);
  if (!snapshotId || !generatedAt) return null;
  const productsByBarcode =
    raw.productsByBarcode &&
    typeof raw.productsByBarcode === "object" &&
    !Array.isArray(raw.productsByBarcode)
      ? (structuredClone(raw.productsByBarcode) as Record<
          string,
          PriceAdjustmentSalesProduct
        >)
      : {};
  return {
    snapshotId,
    generatedAt,
    coverageStart: validIso(raw.coverageStart),
    coverageEnd: validIso(raw.coverageEnd),
    complete: raw.complete === true,
    productCount: Object.keys(productsByBarcode).length,
    updatedAt: validIso(raw.updatedAt) || generatedAt,
    productsByBarcode,
  };
}

function salesCacheFresh(generatedAt: string, now = new Date()) {
  const parsed = Date.parse(generatedAt);
  if (!Number.isFinite(parsed)) return false;
  const age = now.valueOf() - parsed;
  return age >= -5 * 60 * 1000 && age <= 24 * 60 * 60 * 1000;
}

function earlier(current: string | null, candidate: string | null) {
  if (!candidate) return current;
  if (!current) return candidate;
  return candidate < current ? candidate : current;
}

function later(current: string | null, candidate: string | null) {
  if (!candidate) return current;
  if (!current) return candidate;
  return candidate > current ? candidate : current;
}

function validIso(value: unknown) {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

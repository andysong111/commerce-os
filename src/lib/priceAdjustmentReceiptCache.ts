import { temporaryOpsIdentity } from "@/lib/opsLoginBypass";
import {
  getProductLaunchAdminConfig,
  readProductLaunchState,
  writeProductLaunchState,
} from "@/lib/productLaunchTrackerServer";

export const PRICE_ADJUSTMENT_RECEIPT_CACHE_KEY =
  "priceAdjustmentReceiptCache";
export const MAX_RECEIPT_CACHE_BARCODES = 25_000;
export const MAX_RECEIPTS_PER_BARCODE = 3;

export type PriceAdjustmentReceipt = {
  id: string;
  receiptId: string;
  batchId: number;
  orderItemId: number;
  barcode: string;
  modelNumber: string;
  optionName: string;
  quantity: number;
  unitCostKrw: number;
  receivedAt: string;
};

export type PriceAdjustmentReceiptCache = {
  snapshotId: string;
  generatedAt: string;
  complete: boolean;
  barcodeCount: number;
  receiptCount: number;
  updatedAt: string;
  receiptsByBarcode: Record<string, PriceAdjustmentReceipt[]>;
};

type TrackerState = Record<string, unknown> & {
  schemaVersion?: unknown;
  items?: unknown;
  [PRICE_ADJUSTMENT_RECEIPT_CACHE_KEY]?: unknown;
};

export async function mergePriceAdjustmentReceiptCachePage(input: {
  snapshotId: string;
  generatedAt: string;
  complete: boolean;
  receipts: PriceAdjustmentReceipt[];
}) {
  const config = getProductLaunchAdminConfig();
  if (!config.ok) throw new Error(config.body.message);

  const identity = temporaryOpsIdentity();
  const stored = await readProductLaunchState(config.value, identity.userId);
  const state = normalizeTrackerState(stored?.state_payload);
  const current = normalizeCache(state[PRICE_ADJUSTMENT_RECEIPT_CACHE_KEY]);
  const cache =
    current?.snapshotId === input.snapshotId
      ? structuredClone(current)
      : createEmptyCache(input.snapshotId, input.generatedAt);

  for (const receipt of input.receipts) {
    const barcode = normalizeBarcode(receipt.barcode);
    if (!barcode) continue;
    const existing = cache.receiptsByBarcode[barcode] ?? [];
    const byId = new Map(existing.map((row) => [row.id, row]));
    byId.set(receipt.id, { ...receipt, barcode });
    cache.receiptsByBarcode[barcode] = [...byId.values()]
      .sort(compareNewestFirst)
      .slice(0, MAX_RECEIPTS_PER_BARCODE);
  }

  const barcodeCount = Object.keys(cache.receiptsByBarcode).length;
  if (barcodeCount > MAX_RECEIPT_CACHE_BARCODES) {
    throw new Error(
      `가격조정 입고원가 캐시는 최대 ${MAX_RECEIPT_CACHE_BARCODES.toLocaleString(
        "ko-KR",
      )}개 바코드까지 저장할 수 있습니다.`,
    );
  }

  cache.generatedAt = input.generatedAt;
  cache.complete = input.complete;
  cache.barcodeCount = barcodeCount;
  cache.receiptCount = Object.values(cache.receiptsByBarcode).reduce(
    (total, rows) => total + rows.length,
    0,
  );
  cache.updatedAt = new Date().toISOString();

  const nextState: TrackerState = {
    ...state,
    schemaVersion: Math.max(3, Math.floor(Number(state.schemaVersion) || 3)),
    [PRICE_ADJUSTMENT_RECEIPT_CACHE_KEY]: cache,
  };
  await writeProductLaunchState(config.value, identity, nextState);
  return cache;
}

export async function readPriceAdjustmentReceiptCache() {
  const config = getProductLaunchAdminConfig();
  if (!config.ok) throw new Error(config.body.message);
  const identity = temporaryOpsIdentity();
  const stored = await readProductLaunchState(config.value, identity.userId);
  const state = normalizeTrackerState(stored?.state_payload);
  return normalizeCache(state[PRICE_ADJUSTMENT_RECEIPT_CACHE_KEY]);
}

function createEmptyCache(
  snapshotId: string,
  generatedAt: string,
): PriceAdjustmentReceiptCache {
  return {
    snapshotId,
    generatedAt,
    complete: false,
    barcodeCount: 0,
    receiptCount: 0,
    updatedAt: new Date().toISOString(),
    receiptsByBarcode: {},
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

function normalizeCache(value: unknown): PriceAdjustmentReceiptCache | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<PriceAdjustmentReceiptCache>;
  const snapshotId = text(raw.snapshotId);
  const generatedAt = validIso(raw.generatedAt);
  if (!snapshotId || !generatedAt) return null;
  const receiptsByBarcode =
    raw.receiptsByBarcode &&
    typeof raw.receiptsByBarcode === "object" &&
    !Array.isArray(raw.receiptsByBarcode)
      ? (structuredClone(raw.receiptsByBarcode) as Record<
          string,
          PriceAdjustmentReceipt[]
        >)
      : {};
  const normalized: Record<string, PriceAdjustmentReceipt[]> = {};
  for (const [key, rows] of Object.entries(receiptsByBarcode)) {
    const barcode = normalizeBarcode(key);
    if (!barcode || !Array.isArray(rows)) continue;
    normalized[barcode] = rows
      .filter(isReceipt)
      .map((row) => ({ ...row, barcode }))
      .sort(compareNewestFirst)
      .slice(0, MAX_RECEIPTS_PER_BARCODE);
  }
  return {
    snapshotId,
    generatedAt,
    complete: raw.complete === true,
    barcodeCount: Object.keys(normalized).length,
    receiptCount: Object.values(normalized).reduce(
      (total, rows) => total + rows.length,
      0,
    ),
    updatedAt: validIso(raw.updatedAt) || generatedAt,
    receiptsByBarcode: normalized,
  };
}

function isReceipt(value: unknown): value is PriceAdjustmentReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<PriceAdjustmentReceipt>;
  return Boolean(
    text(row.id) &&
      normalizeBarcode(row.barcode) &&
      Number(row.quantity) > 0 &&
      Number(row.unitCostKrw) > 0 &&
      validIso(row.receivedAt),
  );
}

function compareNewestFirst(
  left: PriceAdjustmentReceipt,
  right: PriceAdjustmentReceipt,
) {
  const time = Date.parse(right.receivedAt) - Date.parse(left.receivedAt);
  if (time !== 0) return time;
  return right.id.localeCompare(left.id);
}

function normalizeBarcode(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase();
}

function validIso(value: unknown) {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

import {
  parseShoplingPriceAdjustmentPaste,
  type ShoplingPriceAdjustmentInputResult,
  type ShoplingPriceAdjustmentSource,
} from "@/lib/shoplingPriceAdjustmentInput";

export const SHOPLING_PRICE_ADJUSTMENT_BULK_SELECTION_STORAGE_KEY =
  "shoplingPriceAdjustment.currentBulkSelection";

export type ShoplingPriceAdjustmentInputMode = "uniform" | "individual";

export type ShoplingPriceAdjustmentBulkSelection = {
  label: string;
  mode: ShoplingPriceAdjustmentInputMode;
  result: ShoplingPriceAdjustmentInputResult;
};

type StoredBulkSelection = {
  source?: unknown;
  originalCount?: unknown;
  duplicateCount?: unknown;
  invalidCount?: unknown;
  label?: unknown;
  mode?: unknown;
  rows?: Array<{ goodsKey?: unknown; adjustmentBps?: unknown }>;
};

function isAdjustmentSource(value: unknown): value is ShoplingPriceAdjustmentSource {
  return value === "paste" || value === "csv" || value === "xlsx";
}

function isInputMode(value: unknown): value is ShoplingPriceAdjustmentInputMode {
  return value === "uniform" || value === "individual";
}

function safeCount(value: unknown, fallback: number) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

export function parseStoredShoplingPriceAdjustmentBulkSelection(
  storedText: string | null,
): ShoplingPriceAdjustmentBulkSelection | null {
  if (!storedText) return null;

  try {
    const stored = JSON.parse(storedText) as StoredBulkSelection;
    const rows = Array.isArray(stored.rows) ? stored.rows : [];
    const parsed = parseShoplingPriceAdjustmentPaste(
      rows.map((row) =>
        `${String(row.goodsKey ?? "")} ${Number(row.adjustmentBps) / 100}`,
      ).join("\n"),
    );
    if (parsed.validCount === 0 || parsed.invalidCount > 0) return null;

    const firstAdjustment = parsed.rows[0]?.adjustmentBps;
    const inferredMode = parsed.rows.every(
      (row) => row.adjustmentBps === firstAdjustment,
    )
      ? "uniform"
      : "individual";
    const mode = isInputMode(stored.mode) ? stored.mode : inferredMode;
    const storedLabel =
      typeof stored.label === "string" ? stored.label.trim() : "";

    return {
      label:
        storedLabel
          ? storedLabel.endsWith("· 복원됨")
            ? storedLabel
            : `${storedLabel} · 복원됨`
          : "저장된 Bulk 입력 · 복원됨",
      mode,
      result: {
        ...parsed,
        source: isAdjustmentSource(stored.source)
          ? stored.source
          : parsed.source,
        originalCount: safeCount(stored.originalCount, parsed.originalCount),
        duplicateCount: safeCount(stored.duplicateCount, parsed.duplicateCount),
        invalidCount: 0,
        invalid: [],
      },
    };
  } catch {
    return null;
  }
}

export function stringifyShoplingPriceAdjustmentBulkSelection(
  selection: ShoplingPriceAdjustmentBulkSelection,
) {
  return JSON.stringify({
    source: selection.result.source,
    originalCount: selection.result.originalCount,
    duplicateCount: selection.result.duplicateCount,
    invalidCount: selection.result.invalidCount,
    label: selection.label,
    mode: selection.mode,
    rows: selection.result.rows.map((row) => ({
      goodsKey: row.goodsKey,
      adjustmentBps: row.adjustmentBps,
    })),
  });
}

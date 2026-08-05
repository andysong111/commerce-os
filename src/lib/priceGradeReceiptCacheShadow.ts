import { createHash } from "node:crypto";
import {
  readPriceAdjustmentReceiptCache,
  type PriceAdjustmentReceipt,
  type PriceAdjustmentReceiptCache,
} from "@/lib/priceAdjustmentReceiptCache";
import {
  comparePriceGradeInputs,
  loadPriceGradeInputSnapshot,
  type PriceGradeInputSnapshot,
  type PriceGradeShadowResult,
} from "@/lib/priceGradeShadowComparison";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

const OPERATION_TYPE = "PRICE_GRADE_SHADOW_COMPARISON";
const AUGMENTATION_VERSION = "receipt-cache-fallback-v1";

export type PriceGradeReceiptEvidence = {
  augmentationVersion: string;
  cacheAvailable: boolean;
  cacheComplete: boolean;
  cacheSnapshotId: string | null;
  cacheGeneratedAt: string | null;
  cacheBarcodeCount: number;
  productMasterReceiptProductCount: number;
  productMasterReceiptRowCount: number;
  fallbackProductCount: number;
  fallbackReceiptRowCount: number;
  remainingWithoutReceiptCount: number;
};

export type PriceGradeReceiptCacheShadowResult = PriceGradeShadowResult & {
  receiptEvidence: PriceGradeReceiptEvidence;
};

function normalizeBarcode(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase();
}

function validReceipt(row: PriceAdjustmentReceipt) {
  return (
    Number(row.unitCostKrw) > 0 &&
    Number(row.quantity) > 0 &&
    Number.isFinite(Date.parse(row.receivedAt))
  );
}

function fallbackRows(
  cache: PriceAdjustmentReceiptCache | null,
  barcode: string,
) {
  if (!cache?.complete) return [];
  return (cache.receiptsByBarcode[normalizeBarcode(barcode)] ?? [])
    .filter(validReceipt)
    .map((row) => ({
      receivedAt: row.receivedAt,
      unitCostKrw: Math.max(0, Math.round(Number(row.unitCostKrw) || 0)),
      quantity: Math.max(0, Math.round(Number(row.quantity) || 0)),
    }))
    .sort(
      (left, right) =>
        Date.parse(right.receivedAt) - Date.parse(left.receivedAt),
    )
    .slice(0, 3);
}

function fingerprint(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

export function augmentPriceGradeSnapshotWithReceiptCache(
  snapshot: PriceGradeInputSnapshot,
  cache: PriceAdjustmentReceiptCache | null,
) {
  let productMasterReceiptProductCount = 0;
  let productMasterReceiptRowCount = 0;
  let fallbackProductCount = 0;
  let fallbackReceiptRowCount = 0;
  let remainingWithoutReceiptCount = 0;
  const usedFallback: Array<{
    barcode: string;
    receipts: Array<{
      receivedAt: string;
      unitCostKrw: number;
      quantity?: number;
    }>;
  }> = [];

  const inputs = snapshot.inputs.map((input) => {
    if (Array.isArray(input.receipts) && input.receipts.length > 0) {
      productMasterReceiptProductCount += 1;
      productMasterReceiptRowCount += input.receipts.length;
      return input;
    }
    const receipts = fallbackRows(cache, input.barcode);
    if (!receipts.length) {
      remainingWithoutReceiptCount += 1;
      return input;
    }
    fallbackProductCount += 1;
    fallbackReceiptRowCount += receipts.length;
    usedFallback.push({
      barcode: normalizeBarcode(input.barcode),
      receipts,
    });
    return {
      ...input,
      receipts,
    };
  });

  usedFallback.sort((left, right) => left.barcode.localeCompare(right.barcode));
  const contentFingerprint = fingerprint({
    base: snapshot.contentFingerprint,
    augmentationVersion: AUGMENTATION_VERSION,
    cacheSnapshotId: cache?.complete ? cache.snapshotId : null,
    cacheGeneratedAt: cache?.complete ? cache.generatedAt : null,
    usedFallback,
  });
  const receiptEvidence: PriceGradeReceiptEvidence = {
    augmentationVersion: AUGMENTATION_VERSION,
    cacheAvailable: Boolean(cache),
    cacheComplete: cache?.complete === true,
    cacheSnapshotId: cache?.snapshotId ?? null,
    cacheGeneratedAt: cache?.generatedAt ?? null,
    cacheBarcodeCount: cache?.barcodeCount ?? 0,
    productMasterReceiptProductCount,
    productMasterReceiptRowCount,
    fallbackProductCount,
    fallbackReceiptRowCount,
    remainingWithoutReceiptCount,
  };

  return {
    snapshot: {
      ...snapshot,
      contentFingerprint,
      inputs,
    } satisfies PriceGradeInputSnapshot,
    receiptEvidence,
  };
}

async function loadReceiptCacheSafely() {
  try {
    return await readPriceAdjustmentReceiptCache();
  } catch {
    return null;
  }
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(
    /\/$/,
    "",
  );
  const secret = (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

async function storeComparison(result: PriceGradeReceiptCacheShadowResult) {
  const { baseUrl, secret } = supabaseConnection();
  const sourceEventId = [
    "price-grade-shadow",
    result.ruleVersion,
    result.contentFingerprint,
    AUGMENTATION_VERSION,
  ].join(":");
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=id,source_event_id,started_at`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify([
        {
          operation_type: OPERATION_TYPE,
          status: "SUCCEEDED",
          source: "ops-center-price-grade-shadow-receipt-cache",
          source_event_id: sourceEventId,
          correlation_id: `price-grade-shadow:${result.runId}`,
          actor_type: "OPS_OPERATOR",
          input_snapshot: {
            contentFingerprint: result.contentFingerprint,
            inputGeneratedAt: result.inputGeneratedAt,
            inputCount: result.summary.inputCount,
            ruleVersion: result.ruleVersion,
            receiptEvidence: result.receiptEvidence,
          },
          result_snapshot: result,
          started_at: result.generatedAt,
          finished_at: result.generatedAt,
        },
      ]),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`PRICE_GRADE_SHADOW_STORE_FAILED:${response.status}`);
  }
}

export async function runPriceGradeShadowComparisonWithReceiptCache(): Promise<PriceGradeReceiptCacheShadowResult> {
  const [snapshot, cache] = await Promise.all([
    loadPriceGradeInputSnapshot(),
    loadReceiptCacheSafely(),
  ]);
  const augmented = augmentPriceGradeSnapshotWithReceiptCache(snapshot, cache);
  const baseResult = comparePriceGradeInputs(augmented.snapshot);
  const result: PriceGradeReceiptCacheShadowResult = {
    ...baseResult,
    receiptEvidence: augmented.receiptEvidence,
    notice:
      `${baseResult.notice} ` +
      `Product Master 원시 입고행이 없는 ${augmented.receiptEvidence.fallbackProductCount.toLocaleString("ko-KR")}개 상품에는 ` +
      `Ops Center 최근 입고 3회 캐시를 보조 입력으로 사용했고, ` +
      `${augmented.receiptEvidence.remainingWithoutReceiptCount.toLocaleString("ko-KR")}개는 입고원가가 없어 계속 차단했습니다.`,
  };
  await storeComparison(result);
  return result;
}

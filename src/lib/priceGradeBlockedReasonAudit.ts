import { readPriceAdjustmentReceiptCache } from "@/lib/priceAdjustmentReceiptCache";
import {
  augmentPriceGradeSnapshotWithReceiptCache,
  type PriceGradeReceiptEvidence,
} from "@/lib/priceGradeReceiptCacheShadow";
import { calculateProductPriceGrade } from "@/lib/priceGradeEngine";
import { loadPriceGradeInputSnapshot } from "@/lib/priceGradeShadowComparison";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

export const PRICE_GRADE_BLOCKED_REASON_AUDIT_VERSION =
  "price-grade-blocked-reason-audit-v1";

const OPERATION_TYPE = "PRICE_GRADE_BLOCKED_REASON_AUDIT";
const MAX_SAMPLES = 100;

export type PriceGradeBlockedReasonCount = {
  reason: string;
  count: number;
};

export type PriceGradeBlockedReasonSample = {
  skuId: string;
  barcode: string;
  productName: string;
  optionName: string | null;
  currentPrice: number;
  hasExistingLifecycle: boolean;
  blockedReasons: string[];
};

export type PriceGradeBlockedReasonAuditResult = {
  runId: string;
  auditVersion: string;
  generatedAt: string;
  contentFingerprint: string;
  inputGeneratedAt: string;
  summary: {
    inputCount: number;
    blockedInputCount: number;
    unblockedInputCount: number;
    blockedWithExistingLifecycleCount: number;
    blockedWithoutExistingLifecycleCount: number;
    reasonCounts: PriceGradeBlockedReasonCount[];
    combinationCounts: PriceGradeBlockedReasonCount[];
    sampleCount: number;
    sampleTruncated: boolean;
  };
  receiptEvidence: PriceGradeReceiptEvidence;
  samples: PriceGradeBlockedReasonSample[];
  writesEnabled: false;
  notice: string;
};

export type EnsurePriceGradeBlockedReasonAuditResult = {
  processed: boolean;
  reason: "ALREADY_CURRENT" | "AUDITED";
  fingerprintMatchedExpected: boolean;
  result: PriceGradeBlockedReasonAuditResult;
};

type OperationRow = {
  result_snapshot?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").trim();
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

function sortedCounts(values: Map<string, number>) {
  return [...values.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.reason.localeCompare(right.reason),
    );
}

function increment(values: Map<string, number>, key: string) {
  values.set(key, (values.get(key) ?? 0) + 1);
}

async function loadReceiptCacheSafely() {
  try {
    return await readPriceAdjustmentReceiptCache();
  } catch {
    return null;
  }
}

export async function calculatePriceGradeBlockedReasonAudit(): Promise<PriceGradeBlockedReasonAuditResult> {
  const [snapshot, receiptCache] = await Promise.all([
    loadPriceGradeInputSnapshot(),
    loadReceiptCacheSafely(),
  ]);
  const augmented = augmentPriceGradeSnapshotWithReceiptCache(
    snapshot,
    receiptCache,
  );
  const reasonCounts = new Map<string, number>();
  const combinationCounts = new Map<string, number>();
  const samples: PriceGradeBlockedReasonSample[] = [];
  let blockedInputCount = 0;
  let blockedWithExistingLifecycleCount = 0;
  let blockedWithoutExistingLifecycleCount = 0;

  for (const input of augmented.snapshot.inputs) {
    const calculated = calculateProductPriceGrade({
      barcode: input.barcode,
      currentPrice: input.currentPrice,
      currentGrade: input.currentGrade,
      launchedAt: input.launchedAt,
      lastSaleAt: input.lastSaleAt,
      monthlyUnits: input.monthlyUnits,
      receipts: input.receipts,
      discontinued: input.discontinued,
      active: input.active,
      markdownStage: input.markdownStage,
      asOf: augmented.snapshot.generatedAt,
    });
    if (!calculated.blockedReasons.length) continue;

    blockedInputCount += 1;
    if (input.existingLifecycle) blockedWithExistingLifecycleCount += 1;
    else blockedWithoutExistingLifecycleCount += 1;

    const reasons = [...new Set(calculated.blockedReasons)].sort((left, right) =>
      left.localeCompare(right),
    );
    for (const reason of reasons) increment(reasonCounts, reason);
    increment(combinationCounts, reasons.join(" + "));

    if (samples.length < MAX_SAMPLES) {
      samples.push({
        skuId: input.skuId,
        barcode: input.barcode,
        productName: input.productName,
        optionName: input.optionName ?? null,
        currentPrice: input.currentPrice,
        hasExistingLifecycle: Boolean(input.existingLifecycle),
        blockedReasons: reasons,
      });
    }
  }

  return {
    runId: crypto.randomUUID(),
    auditVersion: PRICE_GRADE_BLOCKED_REASON_AUDIT_VERSION,
    generatedAt: new Date().toISOString(),
    contentFingerprint: augmented.snapshot.contentFingerprint,
    inputGeneratedAt: augmented.snapshot.generatedAt,
    summary: {
      inputCount: augmented.snapshot.inputCount,
      blockedInputCount,
      unblockedInputCount: Math.max(
        0,
        augmented.snapshot.inputCount - blockedInputCount,
      ),
      blockedWithExistingLifecycleCount,
      blockedWithoutExistingLifecycleCount,
      reasonCounts: sortedCounts(reasonCounts),
      combinationCounts: sortedCounts(combinationCounts),
      sampleCount: samples.length,
      sampleTruncated: blockedInputCount > samples.length,
    },
    receiptEvidence: augmented.receiptEvidence,
    samples,
    writesEnabled: false,
    notice:
      "상품등급 계산이 차단된 전체 상품을 원가·현재가·위치코드·활성상태 사유별로 전수 집계한 읽기 전용 감사 결과입니다.",
  };
}

async function storeAudit(result: PriceGradeBlockedReasonAuditResult) {
  const { baseUrl, secret } = supabaseConnection();
  const sourceEventId = [
    "price-grade-blocked-reason-audit",
    result.auditVersion,
    result.contentFingerprint,
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
          source: "ops-center-price-grade-blocked-reason-audit",
          source_event_id: sourceEventId,
          correlation_id: `price-grade-blocked-reason-audit:${result.runId}`,
          actor_type: "OPS_SYSTEM",
          input_snapshot: {
            auditVersion: result.auditVersion,
            contentFingerprint: result.contentFingerprint,
            inputGeneratedAt: result.inputGeneratedAt,
            inputCount: result.summary.inputCount,
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
    throw new Error(`PRICE_GRADE_BLOCKED_REASON_AUDIT_STORE_FAILED:${response.status}`);
  }
}

function normalizeStoredResult(
  value: unknown,
): PriceGradeBlockedReasonAuditResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as PriceGradeBlockedReasonAuditResult;
  if (
    result.auditVersion !== PRICE_GRADE_BLOCKED_REASON_AUDIT_VERSION ||
    !result.runId ||
    !result.contentFingerprint ||
    !result.summary ||
    !Array.isArray(result.summary.reasonCounts) ||
    !Array.isArray(result.summary.combinationCounts) ||
    !Array.isArray(result.samples) ||
    result.writesEnabled !== false
  ) {
    return null;
  }
  return result;
}

export async function loadLatestPriceGradeBlockedReasonAudit() {
  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?operation_type=eq.${OPERATION_TYPE}&status=eq.SUCCEEDED&select=result_snapshot,started_at&order=started_at.desc&limit=1`,
    {
      headers: createSupabaseAdminHeaders(secret),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    throw new Error(`PRICE_GRADE_BLOCKED_REASON_AUDIT_STATUS_FAILED:${response.status}`);
  }
  const rows = (await response.json().catch(() => [])) as OperationRow[];
  return normalizeStoredResult(rows[0]?.result_snapshot);
}

export async function ensurePriceGradeBlockedReasonAudit(
  expectedFingerprint: string | null,
): Promise<EnsurePriceGradeBlockedReasonAuditResult> {
  const latest = await loadLatestPriceGradeBlockedReasonAudit();
  if (
    latest &&
    (!expectedFingerprint || latest.contentFingerprint === expectedFingerprint)
  ) {
    return {
      processed: false,
      reason: "ALREADY_CURRENT",
      fingerprintMatchedExpected:
        !expectedFingerprint || latest.contentFingerprint === expectedFingerprint,
      result: latest,
    };
  }

  const result = await calculatePriceGradeBlockedReasonAudit();
  await storeAudit(result);
  return {
    processed: true,
    reason: "AUDITED",
    fingerprintMatchedExpected:
      !expectedFingerprint || result.contentFingerprint === expectedFingerprint,
    result,
  };
}

export function compactPriceGradeBlockedReasonAudit(
  ensured: EnsurePriceGradeBlockedReasonAuditResult,
) {
  const { result } = ensured;
  return {
    processed: ensured.processed,
    reason: ensured.reason,
    fingerprintMatchedExpected: ensured.fingerprintMatchedExpected,
    runId: result.runId,
    auditVersion: result.auditVersion,
    contentFingerprint: result.contentFingerprint,
    inputCount: result.summary.inputCount,
    blockedInputCount: result.summary.blockedInputCount,
    unblockedInputCount: result.summary.unblockedInputCount,
    blockedWithExistingLifecycleCount:
      result.summary.blockedWithExistingLifecycleCount,
    blockedWithoutExistingLifecycleCount:
      result.summary.blockedWithoutExistingLifecycleCount,
    reasonCounts: result.summary.reasonCounts,
    combinationCounts: result.summary.combinationCounts,
    receiptEvidence: result.receiptEvidence,
    writesEnabled: false as const,
  };
}

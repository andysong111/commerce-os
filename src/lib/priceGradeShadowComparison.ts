import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  PRICE_GRADE_RULE_VERSION,
  calculateProductPriceGrade,
  type ProductPriceGradeResult,
  type ReceiptCostInput,
} from "@/lib/priceGradeEngine";

const OPERATION_TYPE = "PRICE_GRADE_SHADOW_COMPARISON";
const DEFAULT_PRODUCT_MASTER_URL =
  "https://commerce-os-product-master.vercel.app";
const MAX_MISMATCH_SAMPLES = 500;

export type PriceGradeInputLifecycle = {
  grade: number;
  basePrice: number;
  targetPrice: number;
  protectionFloor: number;
  clearanceStage: number;
  lifecycleStatus: string;
  reorderingAllowed: boolean;
  discontinued: boolean;
  gradeReason: string;
  calculatedAt: string;
  source: string;
  shadowMode: boolean;
};

export type PriceGradeShadowInput = {
  skuId: string;
  barcode: string;
  modelNo?: string | null;
  productName: string;
  optionName?: string | null;
  currentPrice: number;
  currentGrade: number;
  launchedAt?: string | null;
  lastSaleAt?: string | null;
  monthlyUnits: number[];
  receipts: ReceiptCostInput[];
  discontinued?: boolean;
  active?: boolean;
  markdownStage?: 0 | 1;
  latestInputAt?: string | null;
  existingLifecycle: PriceGradeInputLifecycle | null;
};

export type PriceGradeInputSnapshot = {
  ok: true;
  generatedAt: string;
  contentFingerprint: string;
  inputCount: number;
  inputs: PriceGradeShadowInput[];
};

export type PriceGradeMismatchKind =
  | "missing_existing_lifecycle"
  | "engine_blocked"
  | "existing_stale_input"
  | "different_rule_source"
  | "unexplained_difference";

export type PriceGradeMismatchSample = {
  skuId: string;
  barcode: string;
  productName: string;
  optionName: string | null;
  kind: PriceGradeMismatchKind;
  previous: {
    grade: number | null;
    targetPrice: number | null;
    protectionFloor: number | null;
    calculatedAt: string | null;
    source: string | null;
    shadowMode: boolean | null;
  };
  calculated: {
    grade: number;
    decision: string;
    targetPrice: number;
    protectionFloor: number;
    ruleVersion: string;
  };
  differences: string[];
  reasons: string[];
  blockedReasons: string[];
};

export type PriceGradeShadowSummary = {
  inputCount: number;
  evaluatedCount: number;
  exactMatchCount: number;
  mismatchCount: number;
  blockedCount: number;
  missingExistingCount: number;
  staleExistingCount: number;
  differentRuleSourceCount: number;
  unexplainedCount: number;
  gradeMismatchCount: number;
  targetPriceMismatchCount: number;
  protectionMismatchCount: number;
  sampleCount: number;
  sampleTruncated: boolean;
};

export type PriceGradeShadowResult = {
  runId: string;
  ruleVersion: string;
  generatedAt: string;
  inputGeneratedAt: string;
  contentFingerprint: string;
  summary: PriceGradeShadowSummary;
  mismatches: PriceGradeMismatchSample[];
  writesEnabled: false;
  notice: string;
};

type OperationRow = {
  id?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
  error_message?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function timestamp(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function productMasterConnection() {
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

export async function loadPriceGradeInputSnapshot(): Promise<PriceGradeInputSnapshot> {
  const { baseUrl, secret } = productMasterConnection();
  const response = await fetch(
    `${baseUrl}/api/integrations/price-grade-input-snapshot`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-commerce-os-integration-secret": secret,
      },
      signal: AbortSignal.timeout(55_000),
      cache: "no-store",
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Partial<PriceGradeInputSnapshot> & {
    message?: string;
    error?: string;
  };
  if (
    !response.ok ||
    payload.ok !== true ||
    !Array.isArray(payload.inputs) ||
    !/^sha256:[a-f0-9]{64}$/.test(text(payload.contentFingerprint))
  ) {
    throw new Error(
      payload.message ||
        payload.error ||
        `PRICE_GRADE_INPUT_FAILED:${response.status}`,
    );
  }
  return {
    ok: true,
    generatedAt: text(payload.generatedAt),
    contentFingerprint: text(payload.contentFingerprint),
    inputCount: integer(payload.inputCount),
    inputs: payload.inputs,
  };
}

function differenceFields(
  existing: PriceGradeInputLifecycle,
  calculated: ProductPriceGradeResult,
) {
  const differences: string[] = [];
  if (integer(existing.grade) !== calculated.grade) differences.push("grade");
  if (integer(existing.targetPrice) !== calculated.recommendedPrice) {
    differences.push("target_price");
  }
  if (integer(existing.protectionFloor) !== calculated.marginFloorPrice) {
    differences.push("protection_floor");
  }
  return differences;
}

function currentRuleSource(source: string) {
  const normalized = text(source).toLowerCase();
  return (
    normalized.includes(PRICE_GRADE_RULE_VERSION.toLowerCase()) ||
    normalized.includes("ops_center_price_grade_v1")
  );
}

function mismatchKind(
  input: PriceGradeShadowInput,
  calculated: ProductPriceGradeResult,
): PriceGradeMismatchKind | null {
  const existing = input.existingLifecycle;
  if (!existing) return "missing_existing_lifecycle";
  if (calculated.blockedReasons.length) return "engine_blocked";
  const existingAt = timestamp(existing.calculatedAt);
  const latestInputAt = timestamp(input.latestInputAt);
  if (
    existingAt !== null &&
    latestInputAt !== null &&
    latestInputAt > existingAt
  ) {
    return "existing_stale_input";
  }
  if (!currentRuleSource(existing.source)) return "different_rule_source";
  return differenceFields(existing, calculated).length
    ? "unexplained_difference"
    : null;
}

function sample(
  input: PriceGradeShadowInput,
  calculated: ProductPriceGradeResult,
  kind: PriceGradeMismatchKind,
): PriceGradeMismatchSample {
  const existing = input.existingLifecycle;
  return {
    skuId: input.skuId,
    barcode: input.barcode,
    productName: input.productName,
    optionName: input.optionName ?? null,
    kind,
    previous: {
      grade: existing?.grade ?? null,
      targetPrice: existing?.targetPrice ?? null,
      protectionFloor: existing?.protectionFloor ?? null,
      calculatedAt: existing?.calculatedAt ?? null,
      source: existing?.source ?? null,
      shadowMode: existing?.shadowMode ?? null,
    },
    calculated: {
      grade: calculated.grade,
      decision: calculated.decision,
      targetPrice: calculated.recommendedPrice,
      protectionFloor: calculated.marginFloorPrice,
      ruleVersion: calculated.ruleVersion,
    },
    differences: existing
      ? differenceFields(existing, calculated)
      : ["existing_lifecycle"],
    reasons: calculated.reasons,
    blockedReasons: calculated.blockedReasons,
  };
}

export function comparePriceGradeInputs(
  snapshot: PriceGradeInputSnapshot,
  runId = crypto.randomUUID(),
): PriceGradeShadowResult {
  const counters = {
    evaluatedCount: 0,
    exactMatchCount: 0,
    mismatchCount: 0,
    blockedCount: 0,
    missingExistingCount: 0,
    staleExistingCount: 0,
    differentRuleSourceCount: 0,
    unexplainedCount: 0,
    gradeMismatchCount: 0,
    targetPriceMismatchCount: 0,
    protectionMismatchCount: 0,
  };
  const mismatches: PriceGradeMismatchSample[] = [];

  for (const input of snapshot.inputs) {
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
      asOf: snapshot.generatedAt,
    });
    counters.evaluatedCount += 1;
    const existing = input.existingLifecycle;
    const differences = existing ? differenceFields(existing, calculated) : [];
    if (differences.includes("grade")) counters.gradeMismatchCount += 1;
    if (differences.includes("target_price")) {
      counters.targetPriceMismatchCount += 1;
    }
    if (differences.includes("protection_floor")) {
      counters.protectionMismatchCount += 1;
    }

    const kind = mismatchKind(input, calculated);
    if (!kind) {
      counters.exactMatchCount += 1;
      continue;
    }
    counters.mismatchCount += 1;
    if (kind === "engine_blocked") counters.blockedCount += 1;
    if (kind === "missing_existing_lifecycle") {
      counters.missingExistingCount += 1;
    }
    if (kind === "existing_stale_input") counters.staleExistingCount += 1;
    if (kind === "different_rule_source") {
      counters.differentRuleSourceCount += 1;
    }
    if (kind === "unexplained_difference") counters.unexplainedCount += 1;
    if (mismatches.length < MAX_MISMATCH_SAMPLES) {
      mismatches.push(sample(input, calculated, kind));
    }
  }

  return {
    runId,
    ruleVersion: PRICE_GRADE_RULE_VERSION,
    generatedAt: new Date().toISOString(),
    inputGeneratedAt: snapshot.generatedAt,
    contentFingerprint: snapshot.contentFingerprint,
    summary: {
      inputCount: snapshot.inputCount,
      ...counters,
      sampleCount: mismatches.length,
      sampleTruncated: counters.mismatchCount > mismatches.length,
    },
    mismatches,
    writesEnabled: false,
    notice:
      "Product Master 원장을 Ops Center 자체 가격등급 엔진으로 다시 계산한 그림자 비교입니다. 실제 가격·등급·단종 상태는 변경하지 않았습니다.",
  };
}

async function storeComparison(result: PriceGradeShadowResult) {
  const { baseUrl, secret } = supabaseConnection();
  const sourceEventId = [
    "price-grade-shadow",
    result.ruleVersion,
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
          source: "ops-center-price-grade-shadow",
          source_event_id: sourceEventId,
          correlation_id: `price-grade-shadow:${result.runId}`,
          actor_type: "OPS_OPERATOR",
          input_snapshot: {
            contentFingerprint: result.contentFingerprint,
            inputGeneratedAt: result.inputGeneratedAt,
            inputCount: result.summary.inputCount,
            ruleVersion: result.ruleVersion,
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

export async function runPriceGradeShadowComparison() {
  const snapshot = await loadPriceGradeInputSnapshot();
  const result = comparePriceGradeInputs(snapshot);
  await storeComparison(result);
  return result;
}

function normalizeStoredResult(value: unknown): PriceGradeShadowResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as PriceGradeShadowResult;
  if (
    !result.runId ||
    !result.summary ||
    !Array.isArray(result.mismatches) ||
    result.writesEnabled !== false
  ) {
    return null;
  }
  return result;
}

export async function loadLatestPriceGradeShadowComparison() {
  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?operation_type=eq.${OPERATION_TYPE}&status=eq.SUCCEEDED&select=id,result_snapshot,started_at,error_message&order=started_at.desc&limit=1`,
    {
      headers: createSupabaseAdminHeaders(secret),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    throw new Error(`PRICE_GRADE_SHADOW_STATUS_FAILED:${response.status}`);
  }
  const rows = (await response.json().catch(() => [])) as OperationRow[];
  return normalizeStoredResult(rows[0]?.result_snapshot);
}

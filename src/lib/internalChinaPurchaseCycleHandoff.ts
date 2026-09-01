import { loadFastPurchaseInternalDrafts } from "@/lib/fastPurchaseInternalDraft";
import { loadStoredInternalChinaForwarderClose } from "@/lib/internalChinaForwarderStoredClose";
import {
  loadInternalChinaFundingCloseByCycleMonth,
  type InternalChinaFundingCloseSummary,
} from "@/lib/internalChinaFundingClose";
import { previousCalendarMonth } from "@/lib/monthlyPurchasePolicy";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

const PRICE_APPROVAL_OPERATION_TYPE =
  "INTERNAL_CHINA_GROUP_COST_PRICE_APPROVAL";
const PRICE_READBACK_OPERATION_TYPE =
  "INTERNAL_CHINA_GROUP_COST_PRICE_BROWSER_READBACK";
const PRICE_READ_TIMEOUT_MS = 3_000;

type StageState = "COMPLETE" | "NEEDS_CHECK" | "NOT_AVAILABLE";

type StoredOperationRow = {
  result_snapshot?: unknown;
  started_at?: unknown;
};

type PriceVerificationSummary = {
  state: StageState;
  fingerprint: string | null;
  goodsKeyCount: number;
  verifiedGoodsKeyCount: number;
  totalMallTargetCount: number;
  matchedMallPriceCount: number;
  mismatchMallPriceCount: number;
  missingMallPriceCount: number;
  errorGoodsKeyCount: number;
  completed: boolean;
};

export type InternalChinaPurchaseCycleHandoff = {
  currentCycleMonth: string;
  previousCycleMonth: string;
  draftCount: number;
  orderedQuantity: number;
  receivedQuantity: number;
  openQuantity: number;
  receiptState: StageState;
  landedCostState: StageState;
  fundingState: StageState;
  fundingClose: InternalChinaFundingCloseSummary | null;
  priceVerification: PriceVerificationSummary;
  quantityImpactReady: boolean;
  warnings: string[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function boolean(value: unknown) {
  return value === true;
}

function validCycleMonth(value: unknown) {
  const cycleMonth = text(value);
  if (!/^\d{4}-\d{2}$/.test(cycleMonth)) {
    throw new Error("CHINA_PURCHASE_CYCLE_HANDOFF_MONTH_INVALID");
  }
  return cycleMonth;
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

async function loadPriceApprovalFingerprint(cycleMonth: string) {
  const { baseUrl, secret } = supabaseConnection();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?operation_type=eq.${PRICE_APPROVAL_OPERATION_TYPE}&status=eq.SUCCEEDED&select=result_snapshot,started_at&order=started_at.desc&limit=24`,
    {
      headers: createSupabaseAdminHeaders(secret),
      cache: "no-store",
      signal: AbortSignal.timeout(PRICE_READ_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`CHINA_PURCHASE_CYCLE_PRICE_APPROVAL_READ_FAILED:${response.status}`);
  }
  const rows = (await response.json().catch(() => [])) as StoredOperationRow[];
  for (const row of rows) {
    const snapshot = object(row.result_snapshot);
    if (text(snapshot.cycleMonth) !== cycleMonth) continue;
    const fingerprint = text(snapshot.proposalFingerprint);
    if (/^sha256:[a-f0-9]{64}$/.test(fingerprint)) return fingerprint;
  }
  return null;
}

function emptyPriceVerification(state: StageState): PriceVerificationSummary {
  return {
    state,
    fingerprint: null,
    goodsKeyCount: 0,
    verifiedGoodsKeyCount: 0,
    totalMallTargetCount: 0,
    matchedMallPriceCount: 0,
    mismatchMallPriceCount: 0,
    missingMallPriceCount: 0,
    errorGoodsKeyCount: 0,
    completed: false,
  };
}

async function loadPriceVerification(
  cycleMonth: string,
): Promise<PriceVerificationSummary> {
  const fingerprint = await loadPriceApprovalFingerprint(cycleMonth);
  if (!fingerprint) return emptyPriceVerification("NOT_AVAILABLE");

  const { baseUrl, secret } = supabaseConnection();
  const sourceEventId =
    `internal-china-group-cost-price-browser-readback:${fingerprint}:aggregate`;
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?operation_type=eq.${PRICE_READBACK_OPERATION_TYPE}&status=eq.SUCCEEDED&source_event_id=eq.${encodeURIComponent(sourceEventId)}&select=result_snapshot,started_at&order=started_at.desc&limit=1`,
    {
      headers: createSupabaseAdminHeaders(secret),
      cache: "no-store",
      signal: AbortSignal.timeout(PRICE_READ_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new Error(`CHINA_PURCHASE_CYCLE_PRICE_READBACK_FAILED:${response.status}`);
  }
  const rows = (await response.json().catch(() => [])) as StoredOperationRow[];
  const snapshot = object(rows[0]?.result_snapshot);
  if (!Object.keys(snapshot).length) {
    return { ...emptyPriceVerification("NEEDS_CHECK"), fingerprint };
  }

  const sourcePlanFingerprint = text(snapshot.sourcePlanFingerprint);
  const goodsKeyCount = integer(snapshot.goodsKeyCount);
  const verifiedGoodsKeyCount = integer(snapshot.verifiedGoodsKeyCount);
  const totalMallTargetCount = integer(snapshot.totalMallTargetCount);
  const matchedMallPriceCount = integer(snapshot.matchedMallPriceCount);
  const mismatchMallPriceCount = integer(snapshot.mismatchMallPriceCount);
  const missingMallPriceCount = integer(snapshot.missingMallPriceCount);
  const errorGoodsKeyCount = integer(snapshot.errorGoodsKeyCount);
  const completed = boolean(snapshot.completed);
  const exactMatch =
    sourcePlanFingerprint === fingerprint &&
    completed &&
    goodsKeyCount > 0 &&
    verifiedGoodsKeyCount === goodsKeyCount &&
    totalMallTargetCount > 0 &&
    matchedMallPriceCount === totalMallTargetCount &&
    mismatchMallPriceCount === 0 &&
    missingMallPriceCount === 0 &&
    errorGoodsKeyCount === 0;

  return {
    state: exactMatch ? "COMPLETE" : "NEEDS_CHECK",
    fingerprint,
    goodsKeyCount,
    verifiedGoodsKeyCount,
    totalMallTargetCount,
    matchedMallPriceCount,
    mismatchMallPriceCount,
    missingMallPriceCount,
    errorGoodsKeyCount,
    completed,
  };
}

export async function loadInternalChinaPurchaseCycleHandoff(
  currentCycleMonthInput: unknown,
): Promise<InternalChinaPurchaseCycleHandoff> {
  const currentCycleMonth = validCycleMonth(currentCycleMonthInput);
  const previousCycleMonth = previousCalendarMonth(currentCycleMonth);
  const warnings: string[] = [];

  const [draftState, fundingClose, priceVerification] = await Promise.all([
    loadFastPurchaseInternalDrafts().catch((error) => ({
      drafts: [],
      error:
        error instanceof Error ? error.message : "CHINA_PURCHASE_CYCLE_DRAFT_READ_FAILED",
    })),
    loadInternalChinaFundingCloseByCycleMonth(previousCycleMonth).catch((error) => {
      warnings.push(
        error instanceof Error
          ? `직전 자금마감 조회: ${error.message}`
          : "직전 자금마감을 조회하지 못했습니다.",
      );
      return null;
    }),
    loadPriceVerification(previousCycleMonth).catch((error) => {
      warnings.push(
        error instanceof Error
          ? `직전 가격검증 조회: ${error.message}`
          : "직전 가격검증을 조회하지 못했습니다.",
      );
      return emptyPriceVerification("NOT_AVAILABLE");
    }),
  ]);

  if (draftState.error) warnings.push(`직전 발주원장 조회: ${draftState.error}`);
  const previousDrafts = draftState.drafts.filter(
    (draft) =>
      draft.cycleMonth === previousCycleMonth && draft.orderedQuantity > 0,
  );
  const orderedQuantity = previousDrafts.reduce(
    (sum, draft) => sum + draft.orderedQuantity,
    0,
  );
  const receivedQuantity = previousDrafts.reduce(
    (sum, draft) => sum + draft.receivedQuantity,
    0,
  );
  const openQuantity = previousDrafts.reduce(
    (sum, draft) => sum + draft.openQuantity,
    0,
  );

  const receiptState: StageState =
    previousDrafts.length === 0
      ? "NOT_AVAILABLE"
      : openQuantity === 0 && receivedQuantity >= orderedQuantity
        ? "COMPLETE"
        : "NEEDS_CHECK";

  const landedCostCloses = await Promise.all(
    previousDrafts.map((draft) =>
      loadStoredInternalChinaForwarderClose(draft.draftId).catch((error) => {
        warnings.push(
          error instanceof Error
            ? `${draft.draftId} 확정원가 조회: ${error.message}`
            : `${draft.draftId} 확정원가를 조회하지 못했습니다.`,
        );
        return null;
      }),
    ),
  );
  const landedCostState: StageState =
    previousDrafts.length === 0
      ? "NOT_AVAILABLE"
      : landedCostCloses.length === previousDrafts.length &&
          landedCostCloses.every(
            (close) =>
              close?.cycleMonth === previousCycleMonth &&
              Number(close.actualCostKrw) > 0 &&
              Number(close.actualMultiplier) > 0,
          )
        ? "COMPLETE"
        : "NEEDS_CHECK";

  const fundingState: StageState = fundingClose ? "COMPLETE" : "NOT_AVAILABLE";
  const quantityImpactReady = receiptState === "COMPLETE" && !draftState.error;

  return {
    currentCycleMonth,
    previousCycleMonth,
    draftCount: previousDrafts.length,
    orderedQuantity,
    receivedQuantity,
    openQuantity,
    receiptState,
    landedCostState,
    fundingState,
    fundingClose,
    priceVerification,
    quantityImpactReady,
    warnings,
  };
}

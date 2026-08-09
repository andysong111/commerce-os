import { createHash } from "node:crypto";
import {
  dispatchShoplingPriceAdjustmentPlan,
  fetchShoplingPriceAdjustmentPlanResult,
  type ShoplingPriceAdjustmentPlanSummary,
} from "@/lib/shoplingPriceAdjustmentPlanRunner";
import { loadReceiptLivePriceProposalStatus } from "@/lib/receiptLivePriceProposalWorker";
import type {
  ReceiptLivePriceGoodsKeyProposal,
  ReceiptLivePriceListingProposal,
  ReceiptLivePriceProposal,
} from "@/lib/receiptLivePriceProposal";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

const PREFLIGHT_REQUEST = "RECEIPT_LIVE_PRICE_CANARY_PREFLIGHT_REQUEST";
const PREFLIGHT_REPORT = "RECEIPT_LIVE_PRICE_CANARY_PREFLIGHT_REPORT";
const PREFLIGHT_FAILURE = "RECEIPT_LIVE_PRICE_CANARY_PREFLIGHT_FAILURE";
const SOURCE_PREFIX = "receipt-live-price-canary-preflight:";
const SHA256 = /^[a-f0-9]{64}$/i;

type OperationRow = {
  status?: unknown;
  source_event_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  error_message?: unknown;
  started_at?: unknown;
};

type Candidate = {
  proposal: ReceiptLivePriceProposal;
  goodsKey: ReceiptLivePriceGoodsKeyProposal;
  listings: ReceiptLivePriceListingProposal[];
  sourceKey: string;
};

export type ReceiptLivePriceCanaryPreflightReport = {
  generatedAt: string;
  state: "READY_ONE_GOODS_KEY";
  proposalFingerprint: string;
  receiptEventId: string;
  receiptId: string;
  batchId: number;
  goodsKey: string;
  productGroup: string;
  ptnGoodsCd: string;
  adjustmentBps: number;
  expectedCurrentSellPrice: number;
  expectedOptionSignature: string;
  currentOptionAmounts: number[];
  targetSellPrice: number;
  targetOptionAmounts: number[];
  currentEffectivePrices: number[];
  targetEffectivePrices: number[];
  planRequestId: string;
  planRunId: number;
  planRunUrl: string | null;
  canaryMode: "OPTION_AWARE_ONE_GOODS_KEY";
  canaryWritesEnabled: false;
  fingerprint: string;
};

export type ReceiptLivePriceCanaryPreflightStatus = {
  state:
    | "NO_PROPOSAL"
    | "NO_ELIGIBLE_CANDIDATE"
    | "PLAN_QUEUED"
    | "PLAN_RUNNING"
    | "READY_ONE_GOODS_KEY"
    | "BLOCKED";
  message: string;
  proposalFingerprint: string | null;
  goodsKey: string | null;
  report: ReceiptLivePriceCanaryPreflightReport | null;
  writesEnabled: false;
  canaryWritesEnabled: false;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function integerArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(integer);
}

function sortedNumbers(values: number[]) {
  return [...values].sort((left, right) => left - right);
}

function arraysEqual(left: number[], right: number[]) {
  const a = sortedNumbers(left);
  const b = sortedNumbers(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

async function rest<T>(input: {
  method?: "GET" | "POST";
  query: URLSearchParams;
  body?: unknown;
  prefer?: string;
}) {
  const { baseUrl, secret } = supabaseConnection();
  const headers = {
    ...createSupabaseAdminHeaders(secret),
    ...(input.prefer ? { Prefer: input.prefer } : {}),
  };
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?${input.query.toString()}`,
    {
      method: input.method ?? "GET",
      headers,
      body: input.method === "POST" ? JSON.stringify(input.body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `RECEIPT_CANARY_PREFLIGHT_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
  return (body ? JSON.parse(body) : null) as T;
}

function sourceKey(proposalFingerprint: string, goodsKey: string) {
  return `${SOURCE_PREFIX}${proposalFingerprint}:${goodsKey}`;
}

async function readOperation(operationType: string, sourceEventId: string) {
  const rows = await rest<OperationRow[]>({
    query: new URLSearchParams({
      operation_type: `eq.${operationType}`,
      source_event_id: `eq.${sourceEventId}`,
      select:
        "status,source_event_id,input_snapshot,result_snapshot,error_message,started_at",
      order: "started_at.desc",
      limit: "1",
    }),
  });
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

async function storeOperation(input: {
  operationType: string;
  sourceEventId: string;
  correlationId: string;
  status: "SUCCEEDED" | "FAILED";
  inputSnapshot: unknown;
  resultSnapshot: unknown;
  errorMessage?: string | null;
}) {
  const now = new Date().toISOString();
  await rest<OperationRow[]>({
    method: "POST",
    query: new URLSearchParams({ on_conflict: "source_event_id" }),
    prefer: "resolution=ignore-duplicates,return=representation",
    body: [
      {
        operation_type: input.operationType,
        status: input.status,
        source: "ops-center-receipt-live-price-canary-preflight",
        source_event_id: input.sourceEventId,
        correlation_id: input.correlationId,
        actor_type: "SYSTEM",
        input_snapshot: input.inputSnapshot,
        result_snapshot: input.resultSnapshot,
        error_message: input.errorMessage ?? null,
        started_at: now,
        finished_at: now,
      },
    ],
  });
}

async function currentCandidate(): Promise<Candidate | null> {
  const status = await loadReceiptLivePriceProposalStatus();
  const proposal = status.latestProposal;
  if (!proposal || !proposal.fingerprint) return null;
  const goodsKey = [...proposal.goodsKeyProposals]
    .filter(
      (row) =>
        row.canaryEligible &&
        row.adjustmentBps !== null &&
        row.changedListingCount > 0,
    )
    .sort(
      (left, right) =>
        Number(left.goodsKey) - Number(right.goodsKey) ||
        left.goodsKey.localeCompare(right.goodsKey),
    )[0];
  if (!goodsKey) {
    return {
      proposal,
      goodsKey: null as unknown as ReceiptLivePriceGoodsKeyProposal,
      listings: [],
      sourceKey: "",
    };
  }
  const listings = proposal.listingProposals.filter(
    (row) => row.goodsKey === goodsKey.goodsKey && row.priceChangeRequired,
  );
  return {
    proposal,
    goodsKey,
    listings,
    sourceKey: sourceKey(proposal.fingerprint, goodsKey.goodsKey),
  };
}

function parseStoredReport(row: OperationRow | null) {
  const value = row?.result_snapshot;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const report = value as ReceiptLivePriceCanaryPreflightReport;
  return report.state === "READY_ONE_GOODS_KEY" && report.fingerprint
    ? report
    : null;
}

function planRequestId(row: OperationRow | null) {
  return text(object(row?.result_snapshot).planRequestId);
}

function planRow(summary: ShoplingPriceAdjustmentPlanSummary) {
  const rows = Array.isArray(summary.rows) ? summary.rows : [];
  if (rows.length !== 1) {
    throw new Error(`RECEIPT_CANARY_PLAN_ROW_COUNT:${rows.length}`);
  }
  return object(rows[0]);
}

function preflightReport(
  candidate: Candidate,
  planRequestIdValue: string,
  planResult: Awaited<ReturnType<typeof fetchShoplingPriceAdjustmentPlanResult>>,
) {
  const summary = planResult.summary;
  if (!summary || text(summary.status) !== "success") {
    throw new Error("RECEIPT_CANARY_PLAN_NOT_SUCCESS");
  }
  if (integer(summary.planned_goods_key_count) !== 1) {
    throw new Error("RECEIPT_CANARY_PLAN_NOT_ONE_GOODS_KEY");
  }
  const row = planRow(summary);
  if (text(row.goods_key) !== candidate.goodsKey.goodsKey) {
    throw new Error("RECEIPT_CANARY_PLAN_GOODS_KEY_MISMATCH");
  }
  if (integer(row.adjustment_bps) !== candidate.goodsKey.adjustmentBps) {
    throw new Error("RECEIPT_CANARY_PLAN_BPS_MISMATCH");
  }
  if (text(row.status) !== "PLANNED") {
    throw new Error(`RECEIPT_CANARY_PLAN_ROW_BLOCKED:${text(row.error)}`);
  }

  const current = object(row.current);
  const target = object(row.target);
  const currentSellPrice = integer(current.sell_price);
  const targetSellPrice = integer(target.sell_price);
  const currentOptionAmounts = integerArray(current.option_amounts);
  const targetOptionAmounts = integerArray(target.option_amounts);
  const optionSignature = text(current.option_signature);
  if (!(currentSellPrice > 0) || !(targetSellPrice > 0) || !SHA256.test(optionSignature)) {
    throw new Error("RECEIPT_CANARY_PLAN_CURRENT_CONTEXT_INVALID");
  }

  const basePrices = [...new Set(candidate.listings.map((item) => item.currentBaseSalePrice))];
  if (basePrices.length !== 1 || basePrices[0] !== currentSellPrice) {
    throw new Error("RECEIPT_CANARY_LIVE_BASE_PRICE_DRIFT");
  }
  const proposalCurrentOptionAmounts = candidate.listings.map(
    (item) => item.currentOptionAmount,
  );
  if (!arraysEqual(proposalCurrentOptionAmounts, currentOptionAmounts)) {
    throw new Error("RECEIPT_CANARY_LIVE_OPTION_AMOUNT_DRIFT");
  }

  const proposalCurrentEffective = candidate.listings.map(
    (item) => item.currentEffectiveSalePrice,
  );
  const planCurrentEffective = currentOptionAmounts.length
    ? currentOptionAmounts.map((amount) => currentSellPrice + amount)
    : [currentSellPrice];
  if (!arraysEqual(proposalCurrentEffective, planCurrentEffective)) {
    throw new Error("RECEIPT_CANARY_CURRENT_EFFECTIVE_PRICE_DRIFT");
  }

  const proposalTargetEffective = candidate.listings.map(
    (item) => item.targetEffectiveSalePrice,
  );
  const planTargetEffective = targetOptionAmounts.length
    ? targetOptionAmounts.map((amount) => targetSellPrice + amount)
    : [targetSellPrice];
  if (!arraysEqual(proposalTargetEffective, planTargetEffective)) {
    throw new Error("RECEIPT_CANARY_TARGET_PRICE_MISMATCH");
  }

  const stable = {
    proposalFingerprint: candidate.proposal.fingerprint,
    receiptEventId: candidate.proposal.eventId,
    batchId: candidate.proposal.batchId,
    goodsKey: candidate.goodsKey.goodsKey,
    adjustmentBps: candidate.goodsKey.adjustmentBps,
    currentSellPrice,
    optionSignature,
    currentOptionAmounts: sortedNumbers(currentOptionAmounts),
    targetSellPrice,
    targetOptionAmounts: sortedNumbers(targetOptionAmounts),
    planRequestId: planRequestIdValue,
    planRunId: planResult.runId,
  };
  return {
    generatedAt: new Date().toISOString(),
    state: "READY_ONE_GOODS_KEY" as const,
    proposalFingerprint: candidate.proposal.fingerprint,
    receiptEventId: candidate.proposal.eventId,
    receiptId: candidate.proposal.receiptId,
    batchId: candidate.proposal.batchId,
    goodsKey: candidate.goodsKey.goodsKey,
    productGroup: candidate.goodsKey.productGroup,
    ptnGoodsCd: candidate.goodsKey.ptnGoodsCd,
    adjustmentBps: candidate.goodsKey.adjustmentBps!,
    expectedCurrentSellPrice: currentSellPrice,
    expectedOptionSignature: optionSignature,
    currentOptionAmounts: sortedNumbers(currentOptionAmounts),
    targetSellPrice,
    targetOptionAmounts: sortedNumbers(targetOptionAmounts),
    currentEffectivePrices: sortedNumbers(planCurrentEffective),
    targetEffectivePrices: sortedNumbers(planTargetEffective),
    planRequestId: planRequestIdValue,
    planRunId: Number(planResult.runId),
    planRunUrl: planResult.runUrl ?? null,
    canaryMode: "OPTION_AWARE_ONE_GOODS_KEY" as const,
    canaryWritesEnabled: false as const,
    fingerprint: sha256(stable),
  } satisfies ReceiptLivePriceCanaryPreflightReport;
}

export async function runReceiptLivePriceCanaryPreflightStep() {
  const candidate = await currentCandidate();
  if (!candidate) {
    return {
      processed: false,
      state: "NO_PROPOSAL" as const,
      writesEnabled: false as const,
    };
  }
  if (!candidate.sourceKey || !candidate.goodsKey) {
    return {
      processed: false,
      state: "NO_ELIGIBLE_CANDIDATE" as const,
      proposalFingerprint: candidate.proposal.fingerprint,
      writesEnabled: false as const,
    };
  }

  const reportId = `${candidate.sourceKey}:report`;
  const failureId = `${candidate.sourceKey}:failure`;
  if (await readOperation(PREFLIGHT_REPORT, reportId)) {
    return {
      processed: false,
      state: "READY_ONE_GOODS_KEY" as const,
      proposalFingerprint: candidate.proposal.fingerprint,
      goodsKey: candidate.goodsKey.goodsKey,
      writesEnabled: false as const,
    };
  }
  if (await readOperation(PREFLIGHT_FAILURE, failureId)) {
    return {
      processed: false,
      state: "BLOCKED" as const,
      proposalFingerprint: candidate.proposal.fingerprint,
      goodsKey: candidate.goodsKey.goodsKey,
      writesEnabled: false as const,
    };
  }

  const requestId = `${candidate.sourceKey}:request`;
  const request = await readOperation(PREFLIGHT_REQUEST, requestId);
  if (!request) {
    const dispatched = await dispatchShoplingPriceAdjustmentPlan([
      {
        goods_key: candidate.goodsKey.goodsKey,
        adjustment_bps: candidate.goodsKey.adjustmentBps,
      },
    ]);
    if (dispatched.status !== "success" || !dispatched.requestId) {
      throw new Error(
        `RECEIPT_CANARY_PLAN_DISPATCH_FAILED:${dispatched.message ?? "unknown"}`,
      );
    }
    await storeOperation({
      operationType: PREFLIGHT_REQUEST,
      sourceEventId: requestId,
      correlationId: candidate.proposal.eventId,
      status: "SUCCEEDED",
      inputSnapshot: {
        proposalFingerprint: candidate.proposal.fingerprint,
        receiptEventId: candidate.proposal.eventId,
        batchId: candidate.proposal.batchId,
        goodsKey: candidate.goodsKey.goodsKey,
        adjustmentBps: candidate.goodsKey.adjustmentBps,
      },
      resultSnapshot: {
        planRequestId: dispatched.requestId,
        githubActionsUrl: dispatched.githubActionsUrl ?? null,
        writesEnabled: false,
      },
    });
    return {
      processed: true,
      state: "PLAN_QUEUED" as const,
      planRequestId: dispatched.requestId,
      writesEnabled: false as const,
    };
  }

  const planRequest = planRequestId(request);
  if (!planRequest) {
    throw new Error("RECEIPT_CANARY_PLAN_REQUEST_ID_MISSING");
  }
  const result = await fetchShoplingPriceAdjustmentPlanResult(planRequest);
  if (result.status === "pending") {
    return {
      processed: false,
      state: "PLAN_RUNNING" as const,
      planRequestId: planRequest,
      writesEnabled: false as const,
    };
  }
  if (result.status !== "success") {
    await storeOperation({
      operationType: PREFLIGHT_FAILURE,
      sourceEventId: failureId,
      correlationId: candidate.proposal.eventId,
      status: "FAILED",
      inputSnapshot: {
        proposalFingerprint: candidate.proposal.fingerprint,
        goodsKey: candidate.goodsKey.goodsKey,
        planRequestId: planRequest,
      },
      resultSnapshot: { writesEnabled: false },
      errorMessage: result.message ?? "READ_ONLY_PLAN_FAILED",
    });
    return {
      processed: true,
      state: "BLOCKED" as const,
      writesEnabled: false as const,
    };
  }

  try {
    const report = preflightReport(candidate, planRequest, result);
    await storeOperation({
      operationType: PREFLIGHT_REPORT,
      sourceEventId: reportId,
      correlationId: candidate.proposal.eventId,
      status: "SUCCEEDED",
      inputSnapshot: {
        proposalFingerprint: candidate.proposal.fingerprint,
        goodsKey: candidate.goodsKey.goodsKey,
        planRequestId: planRequest,
      },
      resultSnapshot: report,
    });
    return {
      processed: true,
      state: "READY_ONE_GOODS_KEY" as const,
      report,
      writesEnabled: false as const,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await storeOperation({
      operationType: PREFLIGHT_FAILURE,
      sourceEventId: failureId,
      correlationId: candidate.proposal.eventId,
      status: "FAILED",
      inputSnapshot: {
        proposalFingerprint: candidate.proposal.fingerprint,
        goodsKey: candidate.goodsKey.goodsKey,
        planRequestId: planRequest,
      },
      resultSnapshot: { writesEnabled: false },
      errorMessage: message,
    });
    return {
      processed: true,
      state: "BLOCKED" as const,
      message,
      writesEnabled: false as const,
    };
  }
}

export async function loadReceiptLivePriceCanaryPreflightStatus(): Promise<ReceiptLivePriceCanaryPreflightStatus> {
  const candidate = await currentCandidate();
  if (!candidate) {
    return {
      state: "NO_PROPOSAL",
      message: "rollout 이후 새 입고확정 가격제안이 아직 없습니다.",
      proposalFingerprint: null,
      goodsKey: null,
      report: null,
      writesEnabled: false,
      canaryWritesEnabled: false,
    };
  }
  if (!candidate.sourceKey || !candidate.goodsKey) {
    return {
      state: "NO_ELIGIBLE_CANDIDATE",
      message:
        "최근 입고확정 가격제안에는 안전하게 1건 canary로 올릴 goods_key가 없습니다.",
      proposalFingerprint: candidate.proposal.fingerprint,
      goodsKey: null,
      report: null,
      writesEnabled: false,
      canaryWritesEnabled: false,
    };
  }
  const report = parseStoredReport(
    await readOperation(PREFLIGHT_REPORT, `${candidate.sourceKey}:report`),
  );
  if (report) {
    return {
      state: "READY_ONE_GOODS_KEY",
      message:
        "입고 batch·가격제안·현재 Shopling base/option 금액·읽기 전용 plan target이 모두 일치했습니다. 실제 가격 canary는 별도 승인 전까지 차단됩니다.",
      proposalFingerprint: candidate.proposal.fingerprint,
      goodsKey: candidate.goodsKey.goodsKey,
      report,
      writesEnabled: false,
      canaryWritesEnabled: false,
    };
  }
  const failure = await readOperation(
    PREFLIGHT_FAILURE,
    `${candidate.sourceKey}:failure`,
  );
  if (failure) {
    return {
      state: "BLOCKED",
      message:
        text(failure.error_message) ||
        "읽기 전용 canary 사전검증이 현재 가격제안과 일치하지 않아 차단했습니다.",
      proposalFingerprint: candidate.proposal.fingerprint,
      goodsKey: candidate.goodsKey.goodsKey,
      report: null,
      writesEnabled: false,
      canaryWritesEnabled: false,
    };
  }
  const request = await readOperation(
    PREFLIGHT_REQUEST,
    `${candidate.sourceKey}:request`,
  );
  return {
    state: request ? "PLAN_RUNNING" : "PLAN_QUEUED",
    message: request
      ? "읽기 전용 Shopling plan 결과를 기다리고 있습니다."
      : "안전한 첫 goods_key의 읽기 전용 Shopling plan을 아직 접수하지 않았습니다.",
    proposalFingerprint: candidate.proposal.fingerprint,
    goodsKey: candidate.goodsKey.goodsKey,
    report: null,
    writesEnabled: false,
    canaryWritesEnabled: false,
  };
}

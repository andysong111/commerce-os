import {
  PRODUCT_MASTER_SHOPLING_SALES_REQUEST,
  loadProductMasterShoplingSalesStatus,
  productMasterShoplingSalesConfigured,
} from "@/lib/productMasterShoplingSalesBackfill";
import {
  collectProductMasterShoplingSalesDirectCodeEvidenceChunk,
  combineProductMasterShoplingSalesDirectCodeEvidence,
  type ProductMasterShoplingSalesDirectCodeEvidenceChunk,
  type ProductMasterShoplingSalesDirectCodeEvidenceReport,
} from "@/lib/productMasterShoplingSalesDirectCodeEvidenceEngine";
import { loadProductMasterShoplingSalesUnmappedDiagnostic } from "@/lib/productMasterShoplingSalesUnmappedDiagnostic";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import {
  ShoplingReadClient,
  shoplingReadConfigFromEnv,
  type ShoplingDateRange,
} from "@/lib/shopling/shoplingReadClient";
import {
  createSupabaseAdminClient,
  createSupabaseAdminHeaders,
} from "@/lib/supabase/admin";

export const PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_REQUEST =
  "PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_REQUEST";
export const PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_CHUNK =
  "PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_CHUNK";
export const PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_STEP_FAILURE =
  "PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_STEP_FAILURE";
export const PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_FAILED =
  "PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_FAILED";
export const PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_REPORT =
  "PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_REPORT";

const MAX_STEP_ATTEMPTS = 3;
const OPERATION_LIMIT = 500;

export type ProductMasterShoplingSalesDirectCodeEvidenceRequest = {
  requestId: string;
  baselineRequestId: string;
  planningFingerprint: string;
  chunkDays: number;
  ranges: ShoplingDateRange[];
  createdAt: string;
};

export type ProductMasterShoplingSalesDirectCodeEvidenceStatus = {
  configured: boolean;
  requestId: string | null;
  baselineRequestId: string | null;
  state: "IDLE" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  stage: string;
  message: string;
  completedRanges: number;
  totalRanges: number;
  progress: number;
  directEvidenceRows: number;
  safeOptionIdCount: number;
  highConfidenceStoredSampleCandidates: number;
  report: ProductMasterShoplingSalesDirectCodeEvidenceReport | null;
  error: string | null;
};

type OperationRow = {
  correlation_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  error_message?: unknown;
};

type StoreOperationInput = {
  operationType: string;
  sourceEventId: string;
  correlationId: string;
  status?: "SUCCEEDED" | "FAILED";
  inputSnapshot: unknown;
  resultSnapshot: unknown;
  errorMessage?: string | null;
  occurredAt?: string;
};

type BaselineRequest = {
  requestId: string;
  chunkDays: number;
  ranges: ShoplingDateRange[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: unknown) {
  return Math.max(0, Math.round(number(value)));
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function validDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}

function parseRange(value: unknown): ShoplingDateRange | null {
  const row = object(value);
  const start = text(row.start);
  const end = text(row.end);
  return validDate(start) && validDate(end) && start <= end
    ? { start, end }
    : null;
}

function rangeKey(range: ShoplingDateRange) {
  return `${range.start}:${range.end}`;
}

function evidenceCorrelationId(requestId: string) {
  return `product-master-shopling-sales-direct-code-evidence:${requestId}`;
}

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : text(error);
  return message
    .slice(0, 500)
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, "[redacted]");
}

function shoplingEnvironment() {
  return {
    SHOPLING_LOGIN_ID: process.env.SHOPLING_LOGIN_ID,
    SHOPLING_COMPANY_ID: process.env.SHOPLING_COMPANY_ID,
    SHOPLING_API_AUTH_KEY: process.env.SHOPLING_API_AUTH_KEY,
    SHOPLING_PRODUCTS_API_URL: process.env.SHOPLING_PRODUCTS_API_URL,
    SHOPLING_ORDERS_API_URL: process.env.SHOPLING_ORDERS_API_URL,
    SHOPLING_CLAIMS_API_URL: process.env.SHOPLING_CLAIMS_API_URL,
  };
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

async function storeOperation(input: StoreOperationInput) {
  const { baseUrl, secret } = supabaseConnection();
  const occurredAt = input.occurredAt ?? new Date().toISOString();
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
          operation_type: input.operationType,
          status: input.status ?? "SUCCEEDED",
          source: "ops-center-product-master-shopling-direct-code-evidence",
          source_event_id: input.sourceEventId,
          correlation_id: input.correlationId,
          actor_type: "OPS_READ_ONLY_WORKER",
          input_snapshot: input.inputSnapshot,
          result_snapshot: input.resultSnapshot,
          error_message: input.errorMessage ?? null,
          started_at: occurredAt,
          finished_at: occurredAt,
          updated_at: occurredAt,
        },
      ]),
      cache: "no-store",
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `PRODUCT_MASTER_SHOPLING_DIRECT_CODE_EVIDENCE_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
}

async function readOperations(
  operationType: string,
  correlationId?: string,
  limit = OPERATION_LIMIT,
) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  let query = admin
    .from("commerce_operation_runs")
    .select(
      "correlation_id,input_snapshot,result_snapshot,error_message,started_at",
    )
    .eq("operation_type", operationType);
  if (correlationId) query = query.eq("correlation_id", correlationId);
  const result = await query.order("started_at", { ascending: false }).limit(limit);
  if (result.error) throw new Error(result.error.message);
  return (Array.isArray(result.data) ? result.data : []) as OperationRow[];
}

function parseBaselineRequest(row: OperationRow): BaselineRequest | null {
  const input = object(row.input_snapshot);
  const requestId = text(input.requestId);
  const ranges = Array.isArray(input.ranges)
    ? (input.ranges.map(parseRange).filter(Boolean) as ShoplingDateRange[])
    : [];
  if (!requestId || !ranges.length) return null;
  return {
    requestId,
    chunkDays: Math.max(1, integer(input.chunkDays) || 1),
    ranges,
  };
}

async function latestBaselineRequest() {
  const rows = await readOperations(PRODUCT_MASTER_SHOPLING_SALES_REQUEST, undefined, 20);
  for (const row of rows) {
    const parsed = parseBaselineRequest(row);
    if (parsed) return parsed;
  }
  return null;
}

function parseRequest(
  row: OperationRow,
): ProductMasterShoplingSalesDirectCodeEvidenceRequest | null {
  const input = object(row.input_snapshot);
  const requestId = text(input.requestId);
  const baselineRequestId = text(input.baselineRequestId);
  const planningFingerprint = text(input.planningFingerprint);
  const createdAt = iso(input.createdAt);
  const ranges = Array.isArray(input.ranges)
    ? (input.ranges.map(parseRange).filter(Boolean) as ShoplingDateRange[])
    : [];
  if (
    !requestId ||
    !baselineRequestId ||
    !planningFingerprint ||
    !createdAt ||
    !ranges.length
  ) {
    return null;
  }
  return {
    requestId,
    baselineRequestId,
    planningFingerprint,
    chunkDays: Math.max(1, integer(input.chunkDays) || 1),
    ranges,
    createdAt,
  };
}

function parseChunk(
  row: OperationRow,
): ProductMasterShoplingSalesDirectCodeEvidenceChunk | null {
  const result = object(row.result_snapshot);
  const range = parseRange(result.range);
  if (!range) return null;
  const options = Array.isArray(result.options)
    ? result.options.map(object).map((option) => ({
        optionId: text(option.optionId),
        barcodes: Array.isArray(option.barcodes)
          ? option.barcodes.map(text).filter(Boolean)
          : [],
        productIds: Array.isArray(option.productIds)
          ? option.productIds.map(text).filter(Boolean)
          : [],
        observedRows: integer(option.observedRows),
        firstSeenAt: iso(option.firstSeenAt),
        lastSeenAt: iso(option.lastSeenAt),
      }))
    : [];
  return {
    range,
    fetchedRows: integer(result.fetchedRows),
    validRows: integer(result.validRows),
    directEvidenceRows: integer(result.directEvidenceRows),
    duplicateRows: integer(result.duplicateRows),
    options,
  };
}

function parseReport(row: OperationRow) {
  const result = object(row.result_snapshot);
  const report = result.report;
  return report && typeof report === "object" && !Array.isArray(report)
    ? (report as ProductMasterShoplingSalesDirectCodeEvidenceReport)
    : null;
}

async function latestRequest() {
  const rows = await readOperations(
    PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_REQUEST,
    undefined,
    20,
  );
  for (const row of rows) {
    const parsed = parseRequest(row);
    if (parsed) return parsed;
  }
  return null;
}

async function activeContext() {
  const request = await latestRequest();
  if (!request) return null;
  const correlationId = evidenceCorrelationId(request.requestId);
  const [chunks, failures, failedRuns, reports] = await Promise.all([
    readOperations(
      PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_CHUNK,
      correlationId,
    ),
    readOperations(
      PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_STEP_FAILURE,
      correlationId,
    ),
    readOperations(
      PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_FAILED,
      correlationId,
      5,
    ),
    readOperations(
      PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_REPORT,
      correlationId,
      5,
    ),
  ]);
  return { request, correlationId, chunks, failures, failedRuns, reports };
}

function failureAttempt(row: OperationRow) {
  const input = object(row.input_snapshot);
  return {
    rangeKey: text(input.rangeKey),
    attempt: integer(input.attempt),
    message: safeMessage(row.error_message || object(row.result_snapshot).message),
  };
}

async function validateFrozenContext(
  request: ProductMasterShoplingSalesDirectCodeEvidenceRequest,
) {
  const [baselineStatus, planning] = await Promise.all([
    loadProductMasterShoplingSalesStatus(),
    loadProductPlanningSnapshot(),
  ]);
  if (baselineStatus.requestId !== request.baselineRequestId) {
    throw new Error("DIRECT_CODE_EVIDENCE_BASELINE_CHANGED");
  }
  if (text(planning.contentFingerprint) !== request.planningFingerprint) {
    throw new Error("DIRECT_CODE_EVIDENCE_PLANNING_CHANGED");
  }
  return { baselineStatus, planning };
}

export function productMasterShoplingSalesDirectCodeEvidenceConfigured() {
  if (!productMasterShoplingSalesConfigured()) return false;
  try {
    shoplingReadConfigFromEnv(shoplingEnvironment());
    supabaseConnection();
    return true;
  } catch {
    return false;
  }
}

export async function createProductMasterShoplingSalesDirectCodeEvidenceRequest() {
  if (!productMasterShoplingSalesDirectCodeEvidenceConfigured()) {
    throw new Error("DIRECT_CODE_EVIDENCE_NOT_CONFIGURED");
  }
  const [baselineStatus, baselineRequest, planning] = await Promise.all([
    loadProductMasterShoplingSalesStatus(),
    latestBaselineRequest(),
    loadProductPlanningSnapshot(),
  ]);
  if (
    baselineStatus.state !== "BLOCKED" ||
    !baselineStatus.requestId ||
    baselineStatus.unmappedRows < 1
  ) {
    throw new Error("DIRECT_CODE_EVIDENCE_BASELINE_NOT_BLOCKED");
  }
  if (!baselineRequest || baselineRequest.requestId !== baselineStatus.requestId) {
    throw new Error("DIRECT_CODE_EVIDENCE_BASELINE_REQUEST_MISMATCH");
  }
  const planningFingerprint = text(planning.contentFingerprint);
  if (!planningFingerprint) {
    throw new Error("DIRECT_CODE_EVIDENCE_PLANNING_FINGERPRINT_MISSING");
  }
  const request: ProductMasterShoplingSalesDirectCodeEvidenceRequest = {
    requestId: crypto.randomUUID(),
    baselineRequestId: baselineRequest.requestId,
    planningFingerprint,
    chunkDays: baselineRequest.chunkDays,
    ranges: baselineRequest.ranges,
    createdAt: new Date().toISOString(),
  };
  await storeOperation({
    operationType: PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_REQUEST,
    sourceEventId: `product-master-shopling-sales-direct-code-evidence-request:${request.requestId}`,
    correlationId: evidenceCorrelationId(request.requestId),
    inputSnapshot: request,
    resultSnapshot: {
      accepted: true,
      state: "QUEUED",
      baselineUnmappedRows: baselineStatus.unmappedRows,
      message:
        "동일 optionId의 다른 주문행에 실제 위치코드가 남아 있는지 24개월 주문범위를 읽기 전용으로 전수 확인합니다.",
    },
    occurredAt: request.createdAt,
  });
  return request;
}

async function finalize(
  context: NonNullable<Awaited<ReturnType<typeof activeContext>>>,
  chunks: ProductMasterShoplingSalesDirectCodeEvidenceChunk[],
) {
  const { planning } = await validateFrozenContext(context.request);
  const unmapped = await loadProductMasterShoplingSalesUnmappedDiagnostic();
  if (unmapped.requestId !== context.request.baselineRequestId) {
    throw new Error("DIRECT_CODE_EVIDENCE_UNMAPPED_BASELINE_CHANGED");
  }
  const report = combineProductMasterShoplingSalesDirectCodeEvidence(
    chunks,
    planning,
    unmapped.safeSamples,
  );
  await storeOperation({
    operationType: PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_REPORT,
    sourceEventId: `product-master-shopling-sales-direct-code-evidence-report:${context.request.requestId}`,
    correlationId: context.correlationId,
    inputSnapshot: {
      requestId: context.request.requestId,
      baselineRequestId: context.request.baselineRequestId,
      rangeCount: context.request.ranges.length,
    },
    resultSnapshot: { report },
  });
  return report;
}

export async function runProductMasterShoplingSalesDirectCodeEvidenceStep() {
  const context = await activeContext();
  if (!context) {
    return {
      processed: false,
      state: "IDLE" as const,
      message: "직접 위치코드 증거 스캔 작업이 없습니다.",
    };
  }
  const completedReport = context.reports.map(parseReport).find(Boolean);
  if (completedReport) {
    return {
      processed: false,
      state: "COMPLETED" as const,
      report: completedReport,
      message:
        completedReport.highConfidenceStoredSampleCandidates > 0
          ? `저장된 미연결 샘플 중 ${completedReport.highConfidenceStoredSampleCandidates}건에서 같은 optionId의 직접 위치코드 증거를 확인했습니다.`
          : "같은 optionId의 직접 위치코드만으로 안전하게 복원 가능한 저장샘플을 확인하지 못했습니다.",
    };
  }
  if (context.failedRuns.length) {
    return {
      processed: false,
      state: "FAILED" as const,
      message: safeMessage(
        context.failedRuns[0]?.error_message ||
          object(context.failedRuns[0]?.result_snapshot).message,
      ),
    };
  }

  const chunks = context.chunks
    .map(parseChunk)
    .filter(Boolean) as ProductMasterShoplingSalesDirectCodeEvidenceChunk[];
  const completed = new Set(chunks.map((chunk) => rangeKey(chunk.range)));
  const nextRange = context.request.ranges.find(
    (range) => !completed.has(rangeKey(range)),
  );

  if (nextRange) {
    const key = rangeKey(nextRange);
    const attempts = context.failures
      .map(failureAttempt)
      .filter((failure) => failure.rangeKey === key);
    if (attempts.length >= MAX_STEP_ATTEMPTS) {
      const message = `${key} 직접 위치코드 증거 조회가 ${MAX_STEP_ATTEMPTS}회 실패했습니다. 최종 원인: ${attempts[0]?.message || "확인 필요"}`;
      await storeOperation({
        operationType: PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_FAILED,
        sourceEventId: `product-master-shopling-sales-direct-code-evidence-failed:${context.request.requestId}`,
        correlationId: context.correlationId,
        status: "FAILED",
        inputSnapshot: {
          requestId: context.request.requestId,
          rangeKey: key,
          attempts: attempts.length,
        },
        resultSnapshot: { state: "FAILED", message },
        errorMessage: message,
      });
      return { processed: false, state: "FAILED" as const, message };
    }

    try {
      await validateFrozenContext(context.request);
      const config = shoplingReadConfigFromEnv(shoplingEnvironment());
      const rows = await new ShoplingReadClient(config).read("orders", nextRange);
      const result = collectProductMasterShoplingSalesDirectCodeEvidenceChunk(
        rows,
        nextRange,
      );
      await storeOperation({
        operationType: PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_CHUNK,
        sourceEventId: `product-master-shopling-sales-direct-code-evidence-chunk:${context.request.requestId}:${key}`,
        correlationId: context.correlationId,
        inputSnapshot: {
          requestId: context.request.requestId,
          range: nextRange,
          rangeKey: key,
          planningFingerprint: context.request.planningFingerprint,
        },
        resultSnapshot: result,
      });
      return {
        processed: true,
        state: "RUNNING" as const,
        range: nextRange,
        fetchedRows: result.fetchedRows,
        directEvidenceRows: result.directEvidenceRows,
        optionIdCount: result.options.length,
        message: `${key} 주문에서 optionId와 직접 위치코드가 함께 있는 안전 증거를 수집했습니다. 비즈니스 쓰기는 없습니다.`,
      };
    } catch (error) {
      const attempt = attempts.length + 1;
      const message = safeMessage(error);
      await storeOperation({
        operationType:
          PRODUCT_MASTER_SHOPLING_SALES_DIRECT_CODE_EVIDENCE_STEP_FAILURE,
        sourceEventId: `product-master-shopling-sales-direct-code-evidence-step-failure:${context.request.requestId}:${key}:${attempt}`,
        correlationId: context.correlationId,
        status: "FAILED",
        inputSnapshot: {
          requestId: context.request.requestId,
          range: nextRange,
          rangeKey: key,
          attempt,
        },
        resultSnapshot: { state: "RETRY_PENDING", message },
        errorMessage: message,
      });
      return {
        processed: false,
        state: "RUNNING" as const,
        retryPending: true,
        attempt,
        range: nextRange,
        message,
      };
    }
  }

  const report = await finalize(context, chunks);
  return {
    processed: true,
    state: "COMPLETED" as const,
    report,
    message:
      report.highConfidenceStoredSampleCandidates > 0
        ? `직접 위치코드 증거 스캔 완료: 저장 미연결 샘플 ${report.highConfidenceStoredSampleCandidates}건이 고신뢰 복원 후보입니다.`
        : "직접 위치코드 증거 스캔 완료: 고신뢰 복원 후보가 없습니다.",
  };
}

export async function loadProductMasterShoplingSalesDirectCodeEvidenceStatus(): Promise<ProductMasterShoplingSalesDirectCodeEvidenceStatus> {
  const configured = productMasterShoplingSalesDirectCodeEvidenceConfigured();
  if (!configured) {
    return {
      configured: false,
      requestId: null,
      baselineRequestId: null,
      state: "IDLE",
      stage: "환경설정 필요",
      message: "Shopling/Supabase 판매원장 환경설정이 준비되지 않았습니다.",
      completedRanges: 0,
      totalRanges: 0,
      progress: 0,
      directEvidenceRows: 0,
      safeOptionIdCount: 0,
      highConfidenceStoredSampleCandidates: 0,
      report: null,
      error: null,
    };
  }

  try {
    const context = await activeContext();
    if (!context) {
      return {
        configured: true,
        requestId: null,
        baselineRequestId: null,
        state: "IDLE",
        stage: "대기",
        message:
          "과거 Catalog에 exact option 증거가 없을 때 Worker가 같은 optionId의 주문 직접 위치코드 증거를 자동 스캔합니다.",
        completedRanges: 0,
        totalRanges: 0,
        progress: 0,
        directEvidenceRows: 0,
        safeOptionIdCount: 0,
        highConfidenceStoredSampleCandidates: 0,
        report: null,
        error: null,
      };
    }
    const report = context.reports.map(parseReport).find(Boolean) ?? null;
    if (report) {
      return {
        configured: true,
        requestId: context.request.requestId,
        baselineRequestId: context.request.baselineRequestId,
        state: "COMPLETED",
        stage:
          report.highConfidenceStoredSampleCandidates > 0
            ? "복원 후보 발견"
            : "안전 후보 없음",
        message:
          report.highConfidenceStoredSampleCandidates > 0
            ? `저장된 미연결 샘플 ${report.highConfidenceStoredSampleCandidates}건에서 같은 optionId의 직접 위치코드 증거를 확인했습니다.`
            : "같은 optionId의 직접 위치코드 증거만으로 안전하게 복원할 저장샘플은 확인되지 않았습니다.",
        completedRanges: context.request.ranges.length,
        totalRanges: context.request.ranges.length,
        progress: 100,
        directEvidenceRows: report.directEvidenceRows,
        safeOptionIdCount: report.safeOptionIdCount,
        highConfidenceStoredSampleCandidates:
          report.highConfidenceStoredSampleCandidates,
        report,
        error: null,
      };
    }
    if (context.failedRuns.length) {
      const message = safeMessage(
        context.failedRuns[0]?.error_message ||
          object(context.failedRuns[0]?.result_snapshot).message,
      );
      return {
        configured: true,
        requestId: context.request.requestId,
        baselineRequestId: context.request.baselineRequestId,
        state: "FAILED",
        stage: "증거 스캔 실패",
        message,
        completedRanges: context.chunks.map(parseChunk).filter(Boolean).length,
        totalRanges: context.request.ranges.length,
        progress: 0,
        directEvidenceRows: 0,
        safeOptionIdCount: 0,
        highConfidenceStoredSampleCandidates: 0,
        report: null,
        error: message,
      };
    }
    const chunks = context.chunks
      .map(parseChunk)
      .filter(Boolean) as ProductMasterShoplingSalesDirectCodeEvidenceChunk[];
    const completedRanges = chunks.length;
    const totalRanges = context.request.ranges.length;
    return {
      configured: true,
      requestId: context.request.requestId,
      baselineRequestId: context.request.baselineRequestId,
      state: completedRanges ? "RUNNING" : "QUEUED",
      stage: completedRanges ? "주문 직접 위치코드 전수 스캔" : "작업 대기열",
      message: `동일한 ${totalRanges}개 주문 구간에서 optionId와 직접 위치코드가 함께 남아 있는 행을 읽기 전용으로 찾고 있습니다.`,
      completedRanges,
      totalRanges,
      progress: totalRanges
        ? Math.round((completedRanges / totalRanges) * 10_000) / 100
        : 0,
      directEvidenceRows: chunks.reduce(
        (sum, chunk) => sum + chunk.directEvidenceRows,
        0,
      ),
      safeOptionIdCount: 0,
      highConfidenceStoredSampleCandidates: 0,
      report: null,
      error: null,
    };
  } catch (error) {
    const message = safeMessage(error);
    return {
      configured: true,
      requestId: null,
      baselineRequestId: null,
      state: "FAILED",
      stage: "상태 조회 실패",
      message,
      completedRanges: 0,
      totalRanges: 0,
      progress: 0,
      directEvidenceRows: 0,
      safeOptionIdCount: 0,
      highConfidenceStoredSampleCandidates: 0,
      report: null,
      error: message,
    };
  }
}

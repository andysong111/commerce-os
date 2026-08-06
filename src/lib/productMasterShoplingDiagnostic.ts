import {
  buildProductMasterShoplingDiagnostic,
  type DiagnosticShoplingOption,
  type ProductMasterShoplingDiagnosticReport,
} from "@/lib/productMasterShoplingDiagnosticEngine";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import {
  normalizeShoplingBarcode,
  normalizeShoplingProduct,
  type ShoplingRawRow,
} from "@/lib/shopling/shoplingNormalize";
import {
  ShoplingReadClient,
  shoplingReadConfigFromEnv,
  splitShoplingDateRange,
  type ShoplingDateRange,
} from "@/lib/shopling/shoplingReadClient";
import {
  createSupabaseAdminClient,
  createSupabaseAdminHeaders,
} from "@/lib/supabase/admin";

export const PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_REQUEST =
  "PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_REQUEST";
export const PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_CHUNK =
  "PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_CHUNK";
export const PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_STEP_FAILURE =
  "PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_STEP_FAILURE";
export const PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_FAILED =
  "PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_FAILED";
export const PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_REPORT =
  "PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_REPORT";

export const PRODUCT_MASTER_SHOPLING_DEFAULT_CHUNK_DAYS = 30;
export const PRODUCT_MASTER_SHOPLING_FALLBACK_CHUNK_DAYS = 7;

const DEFAULT_CATALOG_MONTHS = 24;
const MAX_CONFIGURED_CHUNK_DAYS = 31;
const MAX_STEP_ATTEMPTS = 3;
const OPERATION_LIMIT = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const MANAGED_BARCODE = /^[A-Z]{3}\d+-\d+$/;

export type ProductMasterShoplingDiagnosticRequest = {
  requestId: string;
  catalogStartDate: string;
  catalogEndDate: string;
  planningGeneratedAt: string;
  planningContentFingerprint: string;
  planningSkuCount: number;
  chunkDays: number;
  supersedesRequestId: string | null;
  ranges: ShoplingDateRange[];
  createdAt: string;
};

export type ProductMasterShoplingDiagnosticStatus = {
  configured: boolean;
  requestId: string | null;
  state: "IDLE" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  stage: string;
  message: string;
  completedRanges: number;
  totalRanges: number;
  progress: number;
  fetchedRows: number;
  managedOptions: number;
  chunkDays: number;
  latestFailureRange: string | null;
  latestFailureAttempt: number;
  latestFailureMessage: string | null;
  report: ProductMasterShoplingDiagnosticReport | null;
  error: string | null;
};

type OperationRow = {
  operation_type?: unknown;
  source_event_id?: unknown;
  correlation_id?: unknown;
  status?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  error_message?: unknown;
  started_at?: unknown;
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

type DiagnosticChunkResult = {
  range: ShoplingDateRange;
  fetchedRows: number;
  activeOptionCount: number;
  managedOptionCount: number;
  ignoredUnmanagedOptionCount: number;
  options: DiagnosticShoplingOption[];
};

type CreateDiagnosticRequestOptions = {
  chunkDays?: number;
  supersedesRequestId?: string | null;
  now?: Date;
};

type DiagnosticFailureAttempt = {
  rangeKey: string;
  attempt: number;
  message: string;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function validDateOnly(value: string) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}

function rangeKey(range: ShoplingDateRange) {
  return `${range.start}:${range.end}`;
}

function inclusiveRangeDays(range: ShoplingDateRange) {
  const start = Date.parse(`${range.start}T00:00:00.000Z`);
  const end = Date.parse(`${range.end}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.floor((end - start) / DAY_MS) + 1;
}

function derivedChunkDays(ranges: ShoplingDateRange[]) {
  return Math.max(1, ...ranges.map(inclusiveRangeDays));
}

function correlationId(requestId: string) {
  return `product-master-shopling-diagnostic:${requestId}`;
}

function safeDiagnosticMessage(value: unknown) {
  return text(value)
    .slice(0, 500)
    .replace(
      /<(?:login_id|company_id|api_auth_key)>[\s\S]*?<\/(?:login_id|company_id|api_auth_key)>/gi,
      "[redacted]",
    )
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, "[redacted]");
}

function safeErrorMessage(error: unknown) {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof Error) {
      const candidate = current as Error & { code?: unknown; cause?: unknown };
      const message = safeDiagnosticMessage(candidate.message);
      const code = safeDiagnosticMessage(candidate.code);
      if (message && !parts.includes(message)) parts.push(message);
      if (code && !parts.includes(code)) parts.push(code);
      current = candidate.cause;
      continue;
    }
    const candidate = object(current);
    const message = safeDiagnosticMessage(candidate.message);
    const code = safeDiagnosticMessage(candidate.code);
    if (message && !parts.includes(message)) parts.push(message);
    if (code && !parts.includes(code)) parts.push(code);
    current = candidate.cause;
  }
  return parts.join(" · ") || "Shopling 상품 조회에 실패했습니다.";
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

export function productMasterShoplingDiagnosticConfigured() {
  try {
    shoplingReadConfigFromEnv(shoplingEnvironment());
    return Boolean(process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim());
  } catch {
    return false;
  }
}

function catalogStartDate(now: Date) {
  const configured = text(process.env.SHOPLING_CATALOG_START_DATE);
  if (configured) {
    if (!validDateOnly(configured)) {
      throw new Error("SHOPLING_CATALOG_START_DATE_INVALID");
    }
    return configured;
  }
  const start = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - (DEFAULT_CATALOG_MONTHS - 1),
      1,
    ),
  );
  return dateOnly(start);
}

function requestedChunkDays(value: unknown) {
  const parsed = Math.trunc(number(value));
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CONFIGURED_CHUNK_DAYS) {
    throw new Error("SHOPLING_CATALOG_CHUNK_DAYS_INVALID");
  }
  return parsed;
}

function catalogChunkDays(explicit?: number) {
  if (explicit !== undefined) return requestedChunkDays(explicit);
  const configured = text(process.env.SHOPLING_CATALOG_CHUNK_DAYS);
  return configured
    ? requestedChunkDays(configured)
    : PRODUCT_MASTER_SHOPLING_DEFAULT_CHUNK_DAYS;
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

async function storeOperation(input: StoreOperationInput) {
  const { baseUrl, secret } = supabaseConnection();
  const occurredAt = input.occurredAt || new Date().toISOString();
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
          source: "ops-center-product-master-shopling-diagnostic",
          source_event_id: input.sourceEventId,
          correlation_id: input.correlationId,
          actor_type: "OPS_OPERATOR",
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
      `PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_STORE_FAILED:${response.status}:${body.slice(0, 500)}`,
    );
  }
  const rows = body ? (JSON.parse(body) as unknown) : [];
  return { duplicate: Array.isArray(rows) && rows.length === 0 };
}

async function readOperations(
  operationType: string,
  requestCorrelationId?: string,
  limit = OPERATION_LIMIT,
) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  let query = admin
    .from("commerce_operation_runs")
    .select(
      "operation_type,source_event_id,correlation_id,status,input_snapshot,result_snapshot,error_message,started_at",
    )
    .eq("operation_type", operationType);
  if (requestCorrelationId) query = query.eq("correlation_id", requestCorrelationId);
  const result = await query.order("started_at", { ascending: false }).limit(limit);
  if (result.error) throw new Error(result.error.message);
  return (Array.isArray(result.data) ? result.data : []).filter(
    (row): row is OperationRow => Boolean(row && typeof row === "object"),
  );
}

function requestFromRow(
  row: OperationRow,
): ProductMasterShoplingDiagnosticRequest | null {
  const value = object(row.input_snapshot);
  const requestId = text(value.requestId);
  const createdAt = iso(value.createdAt);
  const planningGeneratedAt = iso(value.planningGeneratedAt);
  const fingerprint = text(value.planningContentFingerprint);
  const ranges = Array.isArray(value.ranges)
    ? value.ranges
        .map(object)
        .map((range) => ({ start: text(range.start), end: text(range.end) }))
        .filter((range) => validDateOnly(range.start) && validDateOnly(range.end))
    : [];
  if (
    !requestId ||
    !createdAt ||
    !planningGeneratedAt ||
    !/^sha256:[a-f0-9]{64}$/.test(fingerprint) ||
    !ranges.length
  ) {
    return null;
  }
  const storedChunkDays = Math.trunc(number(value.chunkDays));
  return {
    requestId,
    catalogStartDate: text(value.catalogStartDate),
    catalogEndDate: text(value.catalogEndDate),
    planningGeneratedAt,
    planningContentFingerprint: fingerprint,
    planningSkuCount: Math.max(0, Math.round(number(value.planningSkuCount))),
    chunkDays:
      storedChunkDays >= 1 ? storedChunkDays : derivedChunkDays(ranges),
    supersedesRequestId: text(value.supersedesRequestId) || null,
    ranges,
    createdAt,
  };
}

async function latestRequest() {
  const rows = await readOperations(
    PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_REQUEST,
    undefined,
    20,
  );
  for (const row of rows) {
    const request = requestFromRow(row);
    if (request) return request;
  }
  return null;
}

function chunkFromRow(row: OperationRow): DiagnosticChunkResult | null {
  const value = object(row.result_snapshot);
  const range = object(value.range);
  if (!validDateOnly(text(range.start)) || !validDateOnly(text(range.end))) {
    return null;
  }
  const options = Array.isArray(value.options)
    ? value.options
        .map(object)
        .map((option) => ({
          goodsKey: text(option.goodsKey),
          optionId: text(option.optionId),
          barcode: text(option.barcode),
          partnerOptionCode: text(option.partnerOptionCode),
          productName: text(option.productName),
          optionName: text(option.optionName),
          isActive: option.isActive !== false,
        }))
    : [];
  return {
    range: { start: text(range.start), end: text(range.end) },
    fetchedRows: Math.max(0, Math.round(number(value.fetchedRows))),
    activeOptionCount: Math.max(0, Math.round(number(value.activeOptionCount))),
    managedOptionCount: Math.max(0, Math.round(number(value.managedOptionCount))),
    ignoredUnmanagedOptionCount: Math.max(
      0,
      Math.round(number(value.ignoredUnmanagedOptionCount)),
    ),
    options,
  };
}

function reportFromRow(row: OperationRow) {
  const value = object(row.result_snapshot);
  return value.report &&
    typeof value.report === "object" &&
    !Array.isArray(value.report)
    ? (value.report as ProductMasterShoplingDiagnosticReport)
    : null;
}

function failureAttempt(row: OperationRow): DiagnosticFailureAttempt {
  const value = object(row.input_snapshot);
  const range = object(value.range);
  const storedRangeKey = text(value.rangeKey);
  const parsedRangeKey =
    validDateOnly(text(range.start)) && validDateOnly(text(range.end))
      ? rangeKey({ start: text(range.start), end: text(range.end) })
      : "";
  return {
    rangeKey: storedRangeKey || parsedRangeKey,
    attempt: Math.max(0, Math.round(number(value.attempt))),
    message: safeDiagnosticMessage(
      text(row.error_message) || text(object(row.result_snapshot).message),
    ),
  };
}

function latestFailure(
  rows: OperationRow[],
): DiagnosticFailureAttempt | null {
  for (const row of rows) {
    const failure = failureAttempt(row);
    if (failure.message) return failure;
  }
  return null;
}

function managedCode(value: unknown) {
  const normalized = normalizeShoplingBarcode(value);
  return MANAGED_BARCODE.test(normalized) ? normalized : "";
}

function safeOptions(rows: ShoplingRawRow[]): DiagnosticChunkResult["options"] {
  return rows
    .map(normalizeShoplingProduct)
    .filter((option) => option.isActive)
    .map((option) => ({
      goodsKey: option.goodsKey,
      optionId: option.optionId,
      barcode: managedCode(option.barcode),
      partnerOptionCode: managedCode(option.partnerOptionCode),
      productName: option.productName,
      optionName: option.optionName,
      isActive: option.isActive,
    }))
    .filter((option) => Boolean(option.barcode || option.partnerOptionCode));
}

export async function createProductMasterShoplingDiagnosticRequest(
  options: CreateDiagnosticRequestOptions = {},
) {
  shoplingReadConfigFromEnv(shoplingEnvironment());
  const planning = await loadProductPlanningSnapshot();
  const now = options.now ?? new Date();
  const end = dateOnly(now);
  const start = catalogStartDate(now);
  const chunkDays = catalogChunkDays(options.chunkDays);
  if (start > end) throw new Error("SHOPLING_CATALOG_DATE_RANGE_INVALID");
  const request: ProductMasterShoplingDiagnosticRequest = {
    requestId: crypto.randomUUID(),
    catalogStartDate: start,
    catalogEndDate: end,
    planningGeneratedAt: planning.generatedAt,
    planningContentFingerprint: planning.contentFingerprint,
    planningSkuCount: planning.products.length,
    chunkDays,
    supersedesRequestId: text(options.supersedesRequestId) || null,
    ranges: splitShoplingDateRange(start, end, chunkDays),
    createdAt: now.toISOString(),
  };
  await storeOperation({
    operationType: PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_REQUEST,
    sourceEventId: `product-master-shopling-diagnostic-request:${request.requestId}`,
    correlationId: correlationId(request.requestId),
    inputSnapshot: request,
    resultSnapshot: {
      accepted: true,
      state: "QUEUED",
      chunkDays,
      supersedesRequestId: request.supersedesRequestId,
      message: `Shopling 상품·옵션을 최대 ${chunkDays}일 구간으로 읽어 위치코드 연결과 세트 환산수량을 전수 진단합니다.`,
    },
    occurredAt: request.createdAt,
  });
  return request;
}

async function activeRequestContext() {
  const request = await latestRequest();
  if (!request) return null;
  const requestCorrelationId = correlationId(request.requestId);
  const [chunks, failures, reports, failedRuns] = await Promise.all([
    readOperations(
      PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_CHUNK,
      requestCorrelationId,
    ),
    readOperations(
      PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_STEP_FAILURE,
      requestCorrelationId,
    ),
    readOperations(
      PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_REPORT,
      requestCorrelationId,
      5,
    ),
    readOperations(
      PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_FAILED,
      requestCorrelationId,
      5,
    ),
  ]);
  return {
    request,
    requestCorrelationId,
    chunks,
    failures,
    reports,
    failedRuns,
  };
}

export async function runProductMasterShoplingDiagnosticStep() {
  const context = await activeRequestContext();
  if (!context) {
    return {
      processed: false,
      state: "IDLE",
      message: "진행 중인 전수진단이 없습니다.",
    };
  }
  const { request, requestCorrelationId } = context;
  if (context.reports.some(reportFromRow)) {
    return {
      processed: false,
      state: "COMPLETED",
      message: "전수진단이 이미 완료되었습니다.",
    };
  }
  if (context.failedRuns.length) {
    return {
      processed: false,
      state: "FAILED",
      message: "전수진단이 실패 종료되었습니다.",
    };
  }

  const chunkResults = context.chunks
    .map(chunkFromRow)
    .filter(Boolean) as DiagnosticChunkResult[];
  const completed = new Set(
    chunkResults.map((chunk) => rangeKey(chunk.range)),
  );
  const nextRange = request.ranges.find(
    (range) => !completed.has(rangeKey(range)),
  );

  if (nextRange) {
    const key = rangeKey(nextRange);
    const previousFailures = context.failures
      .map(failureAttempt)
      .filter((failure) => failure.rangeKey === key);
    const previousAttempts = previousFailures.length;
    if (previousAttempts >= MAX_STEP_ATTEMPTS) {
      const reason = previousFailures[0]?.message || "";
      const message = `${key} Shopling 상품 조회가 ${MAX_STEP_ATTEMPTS}회 실패했습니다.${reason ? ` 최종 원인: ${reason}` : ""}`;
      await storeOperation({
        operationType: PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_FAILED,
        sourceEventId: `product-master-shopling-diagnostic-failed:${request.requestId}`,
        correlationId: requestCorrelationId,
        status: "FAILED",
        inputSnapshot: {
          requestId: request.requestId,
          rangeKey: key,
          chunkDays: request.chunkDays,
          attempts: previousAttempts,
        },
        resultSnapshot: {
          state: "FAILED",
          message,
          failureReason: reason || null,
        },
        errorMessage: message,
      });
      return { processed: false, state: "FAILED", message };
    }

    try {
      const config = shoplingReadConfigFromEnv(shoplingEnvironment());
      const rows = await new ShoplingReadClient(config).read(
        "products",
        nextRange,
      );
      const normalized = rows.map(normalizeShoplingProduct);
      const active = normalized.filter((option) => option.isActive);
      const options = safeOptions(rows);
      const result: DiagnosticChunkResult = {
        range: nextRange,
        fetchedRows: rows.length,
        activeOptionCount: active.length,
        managedOptionCount: options.length,
        ignoredUnmanagedOptionCount: Math.max(0, active.length - options.length),
        options,
      };
      await storeOperation({
        operationType: PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_CHUNK,
        sourceEventId: `product-master-shopling-diagnostic-chunk:${request.requestId}:${key}`,
        correlationId: requestCorrelationId,
        inputSnapshot: {
          requestId: request.requestId,
          range: nextRange,
          rangeKey: key,
          chunkDays: request.chunkDays,
        },
        resultSnapshot: result,
      });
      return {
        processed: true,
        state: "RUNNING",
        range: nextRange,
        fetchedRows: rows.length,
        managedOptions: options.length,
        message: `${key} Shopling 상품·옵션 진단 구간을 저장했습니다.`,
      };
    } catch (error) {
      const attempt = previousAttempts + 1;
      const message = safeErrorMessage(error);
      await storeOperation({
        operationType: PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_STEP_FAILURE,
        sourceEventId: `product-master-shopling-diagnostic-step-failure:${request.requestId}:${key}:${attempt}`,
        correlationId: requestCorrelationId,
        status: "FAILED",
        inputSnapshot: {
          requestId: request.requestId,
          range: nextRange,
          rangeKey: key,
          chunkDays: request.chunkDays,
          attempt,
        },
        resultSnapshot: { state: "RETRY_PENDING", message },
        errorMessage: message,
      });
      return {
        processed: false,
        state: "RUNNING",
        retryPending: true,
        attempt,
        range: nextRange,
        message,
      };
    }
  }

  const planning = await loadProductPlanningSnapshot();
  if (planning.contentFingerprint !== request.planningContentFingerprint) {
    const message =
      "전수진단 중 상품마스터 내용이 변경되었습니다. 서로 다른 기준을 섞지 않도록 이번 실행을 종료하고 새 진단을 시작해야 합니다.";
    await storeOperation({
      operationType: PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_FAILED,
      sourceEventId: `product-master-shopling-diagnostic-failed:${request.requestId}`,
      correlationId: requestCorrelationId,
      status: "FAILED",
      inputSnapshot: {
        requestId: request.requestId,
        expectedFingerprint: request.planningContentFingerprint,
        currentFingerprint: planning.contentFingerprint,
      },
      resultSnapshot: { state: "FAILED", message },
      errorMessage: message,
    });
    return { processed: false, state: "FAILED", message };
  }

  const optionMap = new Map<string, DiagnosticShoplingOption>();
  for (const chunk of chunkResults) {
    for (const option of chunk.options) {
      const key = [
        option.goodsKey,
        option.optionId,
        option.barcode,
        option.partnerOptionCode,
        option.productName,
        option.optionName,
      ].join("\u0000");
      optionMap.set(key, option);
    }
  }
  const report = buildProductMasterShoplingDiagnostic(
    planning.products,
    [...optionMap.values()],
    new Date().toISOString(),
  );
  await storeOperation({
    operationType: PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_REPORT,
    sourceEventId: `product-master-shopling-diagnostic-report:${request.requestId}`,
    correlationId: requestCorrelationId,
    inputSnapshot: {
      requestId: request.requestId,
      planningContentFingerprint: request.planningContentFingerprint,
      rangeCount: request.ranges.length,
      chunkDays: request.chunkDays,
      optionCount: optionMap.size,
    },
    resultSnapshot: { report },
  });
  return {
    processed: true,
    state: "COMPLETED",
    summary: report.summary,
    message:
      "상품마스터와 Shopling 위치코드·옵션·세트수량 전수진단을 완료했습니다.",
  };
}

export async function loadProductMasterShoplingDiagnosticStatus(): Promise<ProductMasterShoplingDiagnosticStatus> {
  const configured = productMasterShoplingDiagnosticConfigured();
  const context = await activeRequestContext();
  if (!context) {
    return {
      configured,
      requestId: null,
      state: "IDLE",
      stage: "대기",
      message: "아직 Shopling 상품·옵션 전수진단을 실행하지 않았습니다.",
      completedRanges: 0,
      totalRanges: 0,
      progress: 0,
      fetchedRows: 0,
      managedOptions: 0,
      chunkDays: 0,
      latestFailureRange: null,
      latestFailureAttempt: 0,
      latestFailureMessage: null,
      report: null,
      error: null,
    };
  }
  const chunks = context.chunks
    .map(chunkFromRow)
    .filter(Boolean) as DiagnosticChunkResult[];
  const report = context.reports.map(reportFromRow).find(Boolean) ?? null;
  const failed = context.failedRuns[0];
  const recentFailure = latestFailure(context.failures);
  const completedRanges = new Set(
    chunks.map((chunk) => rangeKey(chunk.range)),
  ).size;
  const totalRanges = context.request.ranges.length;
  const progress = totalRanges
    ? Math.min(100, Math.round((completedRanges / totalRanges) * 100))
    : 0;
  const fetchedRows = chunks.reduce((sum, chunk) => sum + chunk.fetchedRows, 0);
  const managedOptions = chunks.reduce(
    (sum, chunk) => sum + chunk.managedOptionCount,
    0,
  );
  const common = {
    configured,
    requestId: context.request.requestId,
    completedRanges,
    totalRanges,
    progress,
    fetchedRows,
    managedOptions,
    chunkDays: context.request.chunkDays,
    latestFailureRange: recentFailure?.rangeKey || null,
    latestFailureAttempt: recentFailure?.attempt || 0,
    latestFailureMessage: recentFailure?.message || null,
  };

  if (report) {
    return {
      ...common,
      state: "COMPLETED",
      stage: "진단 완료",
      message:
        "전수진단 결과가 준비되었습니다. 아직 상품마스터 연결값은 변경하지 않았습니다.",
      completedRanges: totalRanges,
      progress: 100,
      report,
      error: null,
    };
  }
  if (failed) {
    const storedError = safeDiagnosticMessage(
      text(failed.error_message) || text(object(failed.result_snapshot).message),
    );
    const error = recentFailure?.message
      ? `${storedError || "전수진단이 실패했습니다."} 최근 실제 원인: ${recentFailure.message}`
      : storedError || "전수진단 실패";
    return {
      ...common,
      state: "FAILED",
      stage: "실패",
      message: error,
      report: null,
      error,
    };
  }
  return {
    ...common,
    state: completedRanges ? "RUNNING" : "QUEUED",
    stage: completedRanges ? "Shopling 상품 구간 수집 중" : "예약 Worker 대기",
    message: recentFailure
      ? `${completedRanges}/${totalRanges}개 기간 구간을 읽었습니다. ${recentFailure.rangeKey} 구간은 ${recentFailure.attempt}차 재시도 대기 중입니다.`
      : `${completedRanges}/${totalRanges}개 기간 구간을 읽었습니다.`,
    report: null,
    error: null,
  };
}

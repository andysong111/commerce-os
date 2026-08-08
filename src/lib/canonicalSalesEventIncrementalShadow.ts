import { createHash } from "node:crypto";
import {
  PRODUCT_MASTER_SALES_EVENT_FORMAT,
  PRODUCT_MASTER_SALES_EVENT_SOURCE,
  aggregateProductMasterShoplingSalesEventChunk,
  combineProductMasterShoplingSalesEventChunks,
  type ProductMasterSalesEventRow,
  type ProductMasterShoplingSalesEventChunk,
} from "@/lib/productMasterShoplingSalesEventEngine";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { buildShoplingIncrementalWindow } from "@/lib/productMasterShoplingSalesIncrementalEngine";
import {
  ShoplingReadClient,
  shoplingReadConfigFromEnv,
  splitShoplingDateRange,
  type ShoplingDateRange,
} from "@/lib/shopling/shoplingReadClient";
import { loadPostApplyCanonicalReconciliation } from "@/lib/stage8PostApplyCanonicalReconciliation";
import {
  createSupabaseAdminClient,
  createSupabaseAdminHeaders,
} from "@/lib/supabase/admin";

export const CANONICAL_EVENT_INCREMENTAL_SHADOW_REQUEST =
  "CANONICAL_EVENT_INCREMENTAL_SHADOW_REQUEST";
export const CANONICAL_EVENT_INCREMENTAL_SHADOW_CHUNK =
  "CANONICAL_EVENT_INCREMENTAL_SHADOW_CHUNK";
export const CANONICAL_EVENT_INCREMENTAL_SHADOW_VERIFY =
  "CANONICAL_EVENT_INCREMENTAL_SHADOW_VERIFY";
export const CANONICAL_EVENT_INCREMENTAL_SHADOW_REPORT =
  "CANONICAL_EVENT_INCREMENTAL_SHADOW_REPORT";
export const CANONICAL_EVENT_INCREMENTAL_SHADOW_FAILURE =
  "CANONICAL_EVENT_INCREMENTAL_SHADOW_FAILURE";

export const CANONICAL_EVENT_INCREMENTAL_SHADOW_SOURCE_DAYS = 7;
export const CANONICAL_EVENT_INCREMENTAL_SHADOW_VERIFY_BATCH_SIZE = 1_000;
export const CANONICAL_EVENT_INCREMENTAL_SHADOW_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const CANONICAL_EVENT_INCREMENTAL_SHADOW_FAILURE_RETRY_MS = 60 * 60 * 1000;

const DEFAULT_PRODUCT_MASTER_URL = "https://commerce-os-product-master.vercel.app";
const OPERATION_LIMIT = 500;
const MAX_RANGE_ATTEMPTS = 3;
const MAX_MISMATCH_SAMPLES = 100;
const MANAGED_BARCODE = /^B[A-Z]{2}\d+-\d+$/;

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

type FailureSnapshot = {
  rangeKey?: unknown;
  attempt?: unknown;
  message?: unknown;
};

export type CanonicalSalesEventIncrementalShadowRequest = {
  requestId: string;
  analysisAsOf: string;
  startDate: string;
  endDate: string;
  months: string[];
  ranges: ShoplingDateRange[];
  planningMappingFingerprint: string;
  baselineReconciliationFingerprint: string;
  createdAt: string;
};

export type CanonicalSalesEventIncrementalShadowVerifyBatch = {
  batchIndex: number;
  batchCount: number;
  candidateFingerprint: string;
  candidateRows: number;
  exactMatchedRows: number;
  mismatchCount: number;
  mismatchExternalIds: string[];
};

export type CanonicalSalesEventIncrementalShadowReport = {
  generatedAt: string;
  requestId: string;
  analysisAsOf: string;
  startDate: string;
  endDate: string;
  months: string[];
  planningMappingFingerprint: string;
  baselineReconciliationFingerprint: string;
  candidateFingerprint: string;
  fetchedRows: number;
  candidateEventCount: number;
  candidateValidCount: number;
  candidateTombstoneCount: number;
  candidateBaseUnits: number;
  candidateRevenue: number;
  persistedExactMatchCount: number;
  pendingMismatchCount: number;
  pendingMismatchExternalIds: string[];
  unmappedRows: number;
  identityConflictCount: number;
  verifyBatchCount: number;
  fullRefreshStillRequired: true;
  writesEnabled: false;
};

export type CanonicalSalesEventIncrementalShadowStatus = {
  configured: boolean;
  state:
    | "IDLE"
    | "QUEUED"
    | "RUNNING"
    | "SHADOW_READY"
    | "BLOCKED"
    | "FAILED";
  stage: string;
  message: string;
  requestId: string | null;
  analysisAsOf: string | null;
  startDate: string | null;
  endDate: string | null;
  completedRanges: number;
  totalRanges: number;
  verifiedBatches: number;
  totalVerifyBatches: number;
  progress: number;
  report: CanonicalSalesEventIncrementalShadowReport | null;
  writesEnabled: false;
  error: string | null;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value: unknown) {
  return Math.max(0, Math.round(numeric(value)));
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

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : text(error);
  return message
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, "[redacted]")
    .slice(0, 1000);
}

function rangeKey(range: ShoplingDateRange) {
  return `${range.start}:${range.end}`;
}

function correlationId(requestId: string) {
  return `canonical-sales-event-incremental-shadow:${requestId}`;
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

function productMasterConnection() {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_REQUIRED");
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() || DEFAULT_PRODUCT_MASTER_URL
  ).replace(/\/$/, "");
  if (!/^https:\/\//.test(baseUrl)) {
    throw new Error("PRODUCT_MASTER_BASE_URL_INVALID");
  }
  return { baseUrl, secret };
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

export function canonicalSalesEventIncrementalShadowConfigured() {
  try {
    shoplingReadConfigFromEnv(shoplingEnvironment());
    productMasterConnection();
    supabaseConnection();
    return true;
  } catch {
    return false;
  }
}

function planningMappingFingerprint(
  products: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>["products"],
) {
  const normalized = products
    .map((product) => ({
      skuId: text(product.skuId),
      barcode: text(product.barcode).toUpperCase().replace(/\s+/g, ""),
      skuActive: product.skuActive !== false,
      listings: (product.listings ?? [])
        .map((listing) => ({
          goodsKey: text(listing.goodsKey),
          optionId: text(listing.optionId),
          unitsPerOrder: Math.max(1, Math.round(numeric(listing.unitsPerOrder)) || 1),
          active: listing.active !== false,
        }))
        .sort((left, right) =>
          `${left.goodsKey}\u0000${left.optionId}\u0000${left.unitsPerOrder}\u0000${left.active}`.localeCompare(
            `${right.goodsKey}\u0000${right.optionId}\u0000${right.unitsPerOrder}\u0000${right.active}`,
          ),
        ),
    }))
    .filter((row) => MANAGED_BARCODE.test(row.barcode))
    .sort((left, right) =>
      `${left.barcode}\u0000${left.skuId}`.localeCompare(
        `${right.barcode}\u0000${right.skuId}`,
      ),
    );
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex")}`;
}

function candidateFingerprint(events: ProductMasterSalesEventRow[]) {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify(
        events.map((event) => ({
          externalId: event.externalId,
          barcode: event.barcode,
          occurredAt: event.occurredAt,
          quantity: event.quantity,
          revenue: event.revenue,
          validSale: event.validSale,
        })),
      ),
    )
    .digest("hex")}`;
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
          source: "ops-center-canonical-sales-event-incremental-shadow",
          source_event_id: input.sourceEventId,
          correlation_id: input.correlationId,
          actor_type: "SYSTEM",
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
      `CANONICAL_EVENT_INCREMENTAL_SHADOW_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
  return body ? JSON.parse(body) : [];
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
  return (Array.isArray(result.data) ? result.data : []) as OperationRow[];
}

function requestFromRow(row: OperationRow) {
  const value = object(row.input_snapshot);
  const requestId = text(value.requestId);
  const analysisAsOf = iso(value.analysisAsOf);
  const createdAt = iso(value.createdAt);
  const startDate = text(value.startDate);
  const endDate = text(value.endDate);
  const months = Array.isArray(value.months)
    ? value.months.map(text).filter(Boolean)
    : [];
  const ranges = Array.isArray(value.ranges)
    ? value.ranges
        .map(object)
        .map((range) => ({ start: text(range.start), end: text(range.end) }))
        .filter((range) => /^\d{4}-\d{2}-\d{2}$/.test(range.start) && /^\d{4}-\d{2}-\d{2}$/.test(range.end))
    : [];
  const planningMappingFingerprint = text(value.planningMappingFingerprint);
  const baselineReconciliationFingerprint = text(value.baselineReconciliationFingerprint);
  if (
    !requestId ||
    !analysisAsOf ||
    !createdAt ||
    !startDate ||
    !endDate ||
    !months.length ||
    !ranges.length ||
    !/^sha256:[a-f0-9]{64}$/.test(planningMappingFingerprint) ||
    !/^sha256:[a-f0-9]{64}$/.test(baselineReconciliationFingerprint)
  ) {
    return null;
  }
  return {
    requestId,
    analysisAsOf,
    startDate,
    endDate,
    months,
    ranges,
    planningMappingFingerprint,
    baselineReconciliationFingerprint,
    createdAt,
  } satisfies CanonicalSalesEventIncrementalShadowRequest;
}

function chunkFromRow(row: OperationRow) {
  const value = object(row.result_snapshot);
  const range = object(value.range);
  const events = Array.isArray(value.events)
    ? value.events.map(object).map((event) => ({
        externalId: text(event.externalId),
        barcode: text(event.barcode),
        occurredAt: text(event.occurredAt),
        quantity: integer(event.quantity),
        revenue: integer(event.revenue),
        validSale: event.validSale === true,
        syncedAt: text(event.syncedAt),
      }))
    : [];
  if (!text(range.start) || !text(range.end)) return null;
  return {
    range: { start: text(range.start), end: text(range.end) },
    fetchedRows: integer(value.fetchedRows),
    eventRows: integer(value.eventRows),
    validRows: integer(value.validRows),
    tombstoneRows: integer(value.tombstoneRows),
    ignoredRows: integer(value.ignoredRows),
    unmappedRows: integer(value.unmappedRows),
    duplicateRows: integer(value.duplicateRows),
    totalBaseUnits: integer(value.totalBaseUnits),
    totalRevenue: integer(value.totalRevenue),
    events,
    unmappedSamples: Array.isArray(value.unmappedSamples)
      ? (value.unmappedSamples as ProductMasterShoplingSalesEventChunk["unmappedSamples"])
      : [],
  } satisfies ProductMasterShoplingSalesEventChunk;
}

function verifyFromRow(row: OperationRow) {
  const input = object(row.input_snapshot);
  const output = object(row.result_snapshot);
  const batchIndex = integer(input.batchIndex);
  const batchCount = integer(input.batchCount);
  const fingerprint = text(input.candidateFingerprint);
  if (!batchCount || !/^sha256:[a-f0-9]{64}$/.test(fingerprint)) return null;
  const mismatchExternalIds = Array.isArray(output.mismatchExternalIds)
    ? output.mismatchExternalIds.map(text).filter(Boolean)
    : [];
  return {
    batchIndex,
    batchCount,
    candidateFingerprint: fingerprint,
    candidateRows: integer(output.candidateRows),
    exactMatchedRows: integer(output.exactMatchedRows),
    mismatchCount: integer(output.mismatchCount),
    mismatchExternalIds,
  } satisfies CanonicalSalesEventIncrementalShadowVerifyBatch;
}

function reportFromRow(row: OperationRow) {
  const value = object(row.result_snapshot);
  const requestId = text(value.requestId);
  const generatedAt = iso(value.generatedAt);
  const analysisAsOf = iso(value.analysisAsOf);
  if (!requestId || !generatedAt || !analysisAsOf) return null;
  return value as unknown as CanonicalSalesEventIncrementalShadowReport;
}

async function latestRequest() {
  const rows = await readOperations(CANONICAL_EVENT_INCREMENTAL_SHADOW_REQUEST, undefined, 20);
  for (const row of rows) {
    const request = requestFromRow(row);
    if (request) return request;
  }
  return null;
}

async function requestOperations(request: CanonicalSalesEventIncrementalShadowRequest) {
  const cid = correlationId(request.requestId);
  const [chunks, verifies, reports, failures] = await Promise.all([
    readOperations(CANONICAL_EVENT_INCREMENTAL_SHADOW_CHUNK, cid),
    readOperations(CANONICAL_EVENT_INCREMENTAL_SHADOW_VERIFY, cid),
    readOperations(CANONICAL_EVENT_INCREMENTAL_SHADOW_REPORT, cid, 5),
    readOperations(CANONICAL_EVENT_INCREMENTAL_SHADOW_FAILURE, cid, 20),
  ]);
  return { cid, chunks, verifies, reports, failures };
}

async function failRequest(
  request: CanonicalSalesEventIncrementalShadowRequest,
  stage: string,
  message: string,
) {
  await storeOperation({
    operationType: CANONICAL_EVENT_INCREMENTAL_SHADOW_FAILURE,
    sourceEventId: `canonical-event-incremental-shadow-failure:${request.requestId}:${stage}`,
    correlationId: correlationId(request.requestId),
    status: "FAILED",
    inputSnapshot: { requestId: request.requestId, stage },
    resultSnapshot: { state: "FAILED", message },
    errorMessage: message,
  });
  return { processed: false, state: "FAILED" as const, message };
}

async function verifyProductMasterEvents(events: ProductMasterSalesEventRow[]) {
  const { baseUrl, secret } = productMasterConnection();
  const response = await fetch(`${baseUrl}/api/integrations/sales-events/verify`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-commerce-os-integration-secret": secret,
    },
    body: JSON.stringify({
      format: PRODUCT_MASTER_SALES_EVENT_FORMAT,
      source: PRODUCT_MASTER_SALES_EVENT_SOURCE,
      rows: events,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(90_000),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || payload.ok !== true || payload.writesEnabled !== false) {
    throw new Error(
      text(payload.message) || `CANONICAL_EVENT_VERIFY_FAILED:${response.status}`,
    );
  }
  const mismatchExternalIds = Array.isArray(payload.mismatches)
    ? payload.mismatches.map(text).filter(Boolean)
    : [];
  const mismatchCount = integer(payload.mismatchCount);
  const exactMatchedRows = integer(payload.verifiedRows);
  if (
    mismatchCount !== mismatchExternalIds.length ||
    exactMatchedRows + mismatchCount !== events.length
  ) {
    throw new Error(
      `CANONICAL_EVENT_VERIFY_ACCOUNTING_INVALID:${events.length}:${exactMatchedRows}:${mismatchCount}`,
    );
  }
  const candidateIds = new Set(events.map((event) => event.externalId));
  if (mismatchExternalIds.some((externalId) => !candidateIds.has(externalId))) {
    throw new Error("CANONICAL_EVENT_VERIFY_FOREIGN_MISMATCH_ID");
  }
  return { exactMatchedRows, mismatchCount, mismatchExternalIds };
}

export async function createCanonicalSalesEventIncrementalShadowRequest(
  now = new Date(),
) {
  if (!canonicalSalesEventIncrementalShadowConfigured()) {
    throw new Error("CANONICAL_EVENT_INCREMENTAL_SHADOW_NOT_CONFIGURED");
  }
  const reconciliation = await loadPostApplyCanonicalReconciliation();
  if (!reconciliation.ready || !reconciliation.reconciliationFingerprint) {
    throw new Error(
      `CANONICAL_EVENT_INCREMENTAL_BASELINE_REQUIRED:${reconciliation.state}`,
    );
  }
  const planning = await loadProductPlanningSnapshot();
  const window = buildShoplingIncrementalWindow(now, 3);
  const request: CanonicalSalesEventIncrementalShadowRequest = {
    requestId: crypto.randomUUID(),
    analysisAsOf: now.toISOString(),
    startDate: window.startDate,
    endDate: window.endDate,
    months: window.months,
    ranges: splitShoplingDateRange(
      window.startDate,
      window.endDate,
      CANONICAL_EVENT_INCREMENTAL_SHADOW_SOURCE_DAYS,
    ),
    planningMappingFingerprint: planningMappingFingerprint(planning.products),
    baselineReconciliationFingerprint: reconciliation.reconciliationFingerprint,
    createdAt: now.toISOString(),
  };
  await storeOperation({
    operationType: CANONICAL_EVENT_INCREMENTAL_SHADOW_REQUEST,
    sourceEventId: `canonical-event-incremental-shadow-request:${request.requestId}`,
    correlationId: correlationId(request.requestId),
    inputSnapshot: request,
    resultSnapshot: {
      accepted: true,
      state: "QUEUED",
      writesEnabled: false,
      overlapPolicy: "previous-3-full-months-plus-current-month",
    },
    occurredAt: request.createdAt,
  });
  return request;
}

function failureAttempt(row: OperationRow) {
  const value = object(row.input_snapshot) as FailureSnapshot;
  return {
    rangeKey: text(value.rangeKey),
    attempt: integer(value.attempt),
    message: safeMessage(value.message || row.error_message),
  };
}

export async function runCanonicalSalesEventIncrementalShadowStep() {
  const request = await latestRequest();
  if (!request) {
    return { processed: false, state: "IDLE" as const, message: "Shadow 요청이 없습니다." };
  }
  const operations = await requestOperations(request);
  if (operations.reports.length) {
    return {
      processed: false,
      state: "SHADOW_READY" as const,
      message: "현재 exact-event incremental shadow가 완료되었습니다.",
    };
  }
  if (operations.failures.some((row) => text(row.status) === "FAILED")) {
    return {
      processed: false,
      state: "FAILED" as const,
      message: safeMessage(
        operations.failures[0]?.error_message ||
          object(operations.failures[0]?.result_snapshot).message,
      ),
    };
  }

  const planning = await loadProductPlanningSnapshot();
  const currentMappingFingerprint = planningMappingFingerprint(planning.products);
  if (currentMappingFingerprint !== request.planningMappingFingerprint) {
    return failRequest(
      request,
      "MAPPING_CHANGED",
      "Exact-event incremental shadow 수집 중 SKU/Shopling 연결구조가 바뀌어 서로 다른 기준을 섞지 않도록 중단했습니다.",
    );
  }

  const chunks = operations.chunks
    .map(chunkFromRow)
    .filter(Boolean) as ProductMasterShoplingSalesEventChunk[];
  const completedRangeKeys = new Set(chunks.map((chunk) => rangeKey(chunk.range)));
  const nextRange = request.ranges.find(
    (range) => !completedRangeKeys.has(rangeKey(range)),
  );

  if (nextRange) {
    const key = rangeKey(nextRange);
    const attempts = operations.failures
      .map(failureAttempt)
      .filter((failure) => failure.rangeKey === key);
    if (attempts.length >= MAX_RANGE_ATTEMPTS) {
      return failRequest(
        request,
        `RANGE_RETRY_EXHAUSTED:${key}`,
        `${key} Shopling exact-event shadow 조회가 ${MAX_RANGE_ATTEMPTS}회 실패했습니다.`,
      );
    }
    try {
      const config = shoplingReadConfigFromEnv(shoplingEnvironment());
      const rows = await new ShoplingReadClient(config).read("orders", nextRange);
      const result = aggregateProductMasterShoplingSalesEventChunk(
        rows,
        planning,
        nextRange,
        {
          analysisAsOf: request.analysisAsOf,
          syncedAt: request.analysisAsOf,
        },
      );
      await storeOperation({
        operationType: CANONICAL_EVENT_INCREMENTAL_SHADOW_CHUNK,
        sourceEventId: `canonical-event-incremental-shadow-chunk:${request.requestId}:${key}`,
        correlationId: operations.cid,
        inputSnapshot: {
          requestId: request.requestId,
          range: nextRange,
          rangeKey: key,
          planningMappingFingerprint: request.planningMappingFingerprint,
        },
        resultSnapshot: result,
      });
      return {
        processed: true,
        state: "RUNNING" as const,
        phase: "SOURCE_READ" as const,
        range: nextRange,
        fetchedRows: result.fetchedRows,
        eventRows: result.eventRows,
        unmappedRows: result.unmappedRows,
        message: `${key} Shopling 주문행을 exact-event 후보로 읽었습니다.`,
      };
    } catch (error) {
      const attempt = attempts.length + 1;
      const message = safeMessage(error);
      await storeOperation({
        operationType: CANONICAL_EVENT_INCREMENTAL_SHADOW_FAILURE,
        sourceEventId: `canonical-event-incremental-shadow-range-failure:${request.requestId}:${key}:${attempt}`,
        correlationId: operations.cid,
        status: "SUCCEEDED",
        inputSnapshot: {
          requestId: request.requestId,
          rangeKey: key,
          attempt,
          message,
        },
        resultSnapshot: { retryPending: true, message },
        errorMessage: message,
      });
      return {
        processed: false,
        state: "RUNNING" as const,
        phase: "SOURCE_RETRY" as const,
        range: nextRange,
        attempt,
        message,
      };
    }
  }

  const combined = combineProductMasterShoplingSalesEventChunks(chunks);
  if (combined.unmappedRows > 0 || combined.conflictExternalIds.length > 0) {
    return failRequest(
      request,
      "SOURCE_BLOCKERS",
      `Exact-event shadow 안전검증 차단: 미연결 ${combined.unmappedRows}건 · identity/time 충돌 ${combined.conflictExternalIds.length}건.`,
    );
  }

  const fingerprint = candidateFingerprint(combined.events);
  const batchCount = Math.max(
    1,
    Math.ceil(
      combined.events.length /
        CANONICAL_EVENT_INCREMENTAL_SHADOW_VERIFY_BATCH_SIZE,
    ),
  );
  const verifyRows = operations.verifies
    .map(verifyFromRow)
    .filter(Boolean) as CanonicalSalesEventIncrementalShadowVerifyBatch[];
  if (
    verifyRows.some(
      (row) => row.candidateFingerprint !== fingerprint || row.batchCount !== batchCount,
    )
  ) {
    return failRequest(
      request,
      "VERIFY_FINGERPRINT_DRIFT",
      "저장된 verify batch와 현재 exact-event 후보 지문이 달라 검증을 중단했습니다.",
    );
  }
  const verifiedIndexes = new Set(verifyRows.map((row) => row.batchIndex));
  const nextBatchIndex = Array.from({ length: batchCount }, (_, index) => index).find(
    (index) => !verifiedIndexes.has(index),
  );

  if (nextBatchIndex !== undefined) {
    const start =
      nextBatchIndex * CANONICAL_EVENT_INCREMENTAL_SHADOW_VERIFY_BATCH_SIZE;
    const batch = combined.events.slice(
      start,
      start + CANONICAL_EVENT_INCREMENTAL_SHADOW_VERIFY_BATCH_SIZE,
    );
    if (!batch.length) {
      if (combined.events.length === 0 && nextBatchIndex === 0) {
        await storeOperation({
          operationType: CANONICAL_EVENT_INCREMENTAL_SHADOW_VERIFY,
          sourceEventId: `canonical-event-incremental-shadow-verify:${request.requestId}:${fingerprint}:0`,
          correlationId: operations.cid,
          inputSnapshot: {
            requestId: request.requestId,
            batchIndex: 0,
            batchCount: 1,
            candidateFingerprint: fingerprint,
          },
          resultSnapshot: {
            candidateRows: 0,
            exactMatchedRows: 0,
            mismatchCount: 0,
            mismatchExternalIds: [],
            writesEnabled: false,
          },
        });
        return {
          processed: true,
          state: "RUNNING" as const,
          phase: "VERIFY" as const,
          batchIndex: 0,
          message: "조회 기간에 canonical exact-event 후보가 없어 0건 검증을 기록했습니다.",
        };
      }
      return failRequest(
        request,
        "VERIFY_EMPTY_BATCH",
        `Verify batch ${nextBatchIndex}/${batchCount}가 비어 있습니다.`,
      );
    }
    try {
      const verification = await verifyProductMasterEvents(batch);
      await storeOperation({
        operationType: CANONICAL_EVENT_INCREMENTAL_SHADOW_VERIFY,
        sourceEventId: `canonical-event-incremental-shadow-verify:${request.requestId}:${fingerprint}:${nextBatchIndex}`,
        correlationId: operations.cid,
        inputSnapshot: {
          requestId: request.requestId,
          batchIndex: nextBatchIndex,
          batchCount,
          candidateFingerprint: fingerprint,
        },
        resultSnapshot: {
          candidateRows: batch.length,
          exactMatchedRows: verification.exactMatchedRows,
          mismatchCount: verification.mismatchCount,
          mismatchExternalIds: verification.mismatchExternalIds,
          writesEnabled: false,
        },
      });
      return {
        processed: true,
        state: "RUNNING" as const,
        phase: "VERIFY" as const,
        batchIndex: nextBatchIndex,
        batchCount,
        mismatchCount: verification.mismatchCount,
        message: `Persisted canonical 원장과 verify batch ${nextBatchIndex + 1}/${batchCount}를 읽기 전용으로 대조했습니다.`,
      };
    } catch (error) {
      return failRequest(request, `VERIFY:${nextBatchIndex}`, safeMessage(error));
    }
  }

  const refreshed = await requestOperations(request);
  const finalVerifyRows = refreshed.verifies
    .map(verifyFromRow)
    .filter(Boolean) as CanonicalSalesEventIncrementalShadowVerifyBatch[];
  const verifiedByIndex = new Map(finalVerifyRows.map((row) => [row.batchIndex, row]));
  if (verifiedByIndex.size !== batchCount) {
    return failRequest(
      request,
      "VERIFY_COVERAGE",
      `Verify batch ${verifiedByIndex.size}/${batchCount}만 존재합니다.`,
    );
  }
  const mismatchExternalIds = [...verifiedByIndex.values()]
    .flatMap((row) => row.mismatchExternalIds)
    .filter(Boolean);
  const uniqueMismatchExternalIds = [...new Set(mismatchExternalIds)].sort();
  const exactMatchedRows = [...verifiedByIndex.values()].reduce(
    (sum, row) => sum + row.exactMatchedRows,
    0,
  );
  if (exactMatchedRows + uniqueMismatchExternalIds.length !== combined.events.length) {
    return failRequest(
      request,
      "FINAL_ACCOUNTING",
      `Candidate ${combined.events.length}건 · exact ${exactMatchedRows}건 · pending ${uniqueMismatchExternalIds.length}건으로 합계가 맞지 않습니다.`,
    );
  }

  const valid = combined.events.filter((event) => event.validSale);
  const report: CanonicalSalesEventIncrementalShadowReport = {
    generatedAt: new Date().toISOString(),
    requestId: request.requestId,
    analysisAsOf: request.analysisAsOf,
    startDate: request.startDate,
    endDate: request.endDate,
    months: request.months,
    planningMappingFingerprint: request.planningMappingFingerprint,
    baselineReconciliationFingerprint: request.baselineReconciliationFingerprint,
    candidateFingerprint: fingerprint,
    fetchedRows: combined.fetchedRows,
    candidateEventCount: combined.events.length,
    candidateValidCount: valid.length,
    candidateTombstoneCount: combined.events.length - valid.length,
    candidateBaseUnits: valid.reduce((sum, event) => sum + integer(event.quantity), 0),
    candidateRevenue: valid.reduce((sum, event) => sum + integer(event.revenue), 0),
    persistedExactMatchCount: exactMatchedRows,
    pendingMismatchCount: uniqueMismatchExternalIds.length,
    pendingMismatchExternalIds: uniqueMismatchExternalIds.slice(0, MAX_MISMATCH_SAMPLES),
    unmappedRows: combined.unmappedRows,
    identityConflictCount: combined.conflictExternalIds.length,
    verifyBatchCount: batchCount,
    fullRefreshStillRequired: true,
    writesEnabled: false,
  };
  await storeOperation({
    operationType: CANONICAL_EVENT_INCREMENTAL_SHADOW_REPORT,
    sourceEventId: `canonical-event-incremental-shadow-report:${request.requestId}:${fingerprint}`,
    correlationId: operations.cid,
    inputSnapshot: {
      requestId: request.requestId,
      candidateFingerprint: fingerprint,
      planningMappingFingerprint: request.planningMappingFingerprint,
    },
    resultSnapshot: report,
    occurredAt: report.generatedAt,
  });
  return {
    processed: true,
    state: "SHADOW_READY" as const,
    phase: "REPORT" as const,
    report,
    message: `Exact-event overlap 후보 ${report.candidateEventCount}건 중 persisted exact ${report.persistedExactMatchCount}건 · 신규/변경 후보 ${report.pendingMismatchCount}건을 확인했습니다. 쓰기는 차단됩니다.`,
  };
}

export async function ensureCanonicalSalesEventIncrementalShadowRequest(
  now = new Date(),
) {
  const request = await latestRequest();
  if (request) {
    const operations = await requestOperations(request);
    const report = operations.reports.map(reportFromRow).find(Boolean) ?? null;
    const terminalFailure = operations.failures.find(
      (row) => text(row.status) === "FAILED",
    );
    if (!report && !terminalFailure) {
      return {
        created: false,
        state: "RUNNING" as const,
        requestId: request.requestId,
        message: "기존 exact-event incremental shadow를 이어서 처리합니다.",
      };
    }
    if (report) {
      const age = now.getTime() - Date.parse(report.generatedAt);
      if (age < CANONICAL_EVENT_INCREMENTAL_SHADOW_INTERVAL_MS) {
        return {
          created: false,
          state: "IDLE" as const,
          requestId: request.requestId,
          lastCompletedAt: report.generatedAt,
          message: "최근 exact-event shadow 완료 후 6시간이 지나지 않아 재수집을 생략합니다.",
        };
      }
    }
    if (terminalFailure) {
      const failedAt = iso(terminalFailure.started_at);
      if (
        failedAt &&
        now.getTime() - Date.parse(failedAt) <
          CANONICAL_EVENT_INCREMENTAL_SHADOW_FAILURE_RETRY_MS
      ) {
        return {
          created: false,
          state: "FAILED" as const,
          requestId: request.requestId,
          lastFailureAt: failedAt,
          message: "최근 shadow 실패 후 1시간 보호대기 중입니다.",
        };
      }
    }
  }

  const created = await createCanonicalSalesEventIncrementalShadowRequest(now);
  return {
    created: true,
    state: "QUEUED" as const,
    requestId: created.requestId,
    message: "최근 4개 달 exact-event incremental shadow를 접수했습니다.",
  };
}

export async function loadCanonicalSalesEventIncrementalShadowStatus(): Promise<CanonicalSalesEventIncrementalShadowStatus> {
  const configured = canonicalSalesEventIncrementalShadowConfigured();
  const request = await latestRequest();
  const empty: CanonicalSalesEventIncrementalShadowStatus = {
    configured,
    state: "IDLE",
    stage: "대기",
    message: "Exact-event incremental shadow 요청이 아직 없습니다.",
    requestId: null,
    analysisAsOf: null,
    startDate: null,
    endDate: null,
    completedRanges: 0,
    totalRanges: 0,
    verifiedBatches: 0,
    totalVerifyBatches: 0,
    progress: 0,
    report: null,
    writesEnabled: false,
    error: null,
  };
  if (!request) return empty;

  const operations = await requestOperations(request);
  const chunks = operations.chunks
    .map(chunkFromRow)
    .filter(Boolean) as ProductMasterShoplingSalesEventChunk[];
  const completedRanges = new Set(chunks.map((chunk) => rangeKey(chunk.range))).size;
  const report = operations.reports.map(reportFromRow).find(Boolean) ?? null;
  const terminalFailure = operations.failures.find(
    (row) => text(row.status) === "FAILED",
  );
  const combined = combineProductMasterShoplingSalesEventChunks(chunks);
  const candidateBatchCount =
    completedRanges === request.ranges.length
      ? Math.max(
          1,
          Math.ceil(
            combined.events.length /
              CANONICAL_EVENT_INCREMENTAL_SHADOW_VERIFY_BATCH_SIZE,
          ),
        )
      : 0;
  const verifyRows = operations.verifies
    .map(verifyFromRow)
    .filter(Boolean) as CanonicalSalesEventIncrementalShadowVerifyBatch[];
  const verifiedBatches = new Set(verifyRows.map((row) => row.batchIndex)).size;
  const totalUnits = request.ranges.length + candidateBatchCount + 1;
  const completedUnits = completedRanges + verifiedBatches + (report ? 1 : 0);
  const common = {
    ...empty,
    requestId: request.requestId,
    analysisAsOf: request.analysisAsOf,
    startDate: request.startDate,
    endDate: request.endDate,
    completedRanges,
    totalRanges: request.ranges.length,
    verifiedBatches,
    totalVerifyBatches: candidateBatchCount,
    progress: totalUnits
      ? Math.min(100, Math.round((completedUnits / totalUnits) * 100))
      : 0,
    report,
  };

  if (terminalFailure) {
    const error = safeMessage(
      terminalFailure.error_message || object(terminalFailure.result_snapshot).message,
    );
    return {
      ...common,
      state: "FAILED",
      stage: "Shadow 실패",
      message: error,
      error,
    };
  }
  if (report) {
    return {
      ...common,
      state: "SHADOW_READY",
      stage: "읽기 전용 차이 검증 완료",
      message: `Overlap 후보 ${report.candidateEventCount}건 · exact ${report.persistedExactMatchCount}건 · 신규/변경 ${report.pendingMismatchCount}건. 실제 쓰기는 차단됩니다.`,
      progress: 100,
    };
  }
  if (completedRanges < request.ranges.length) {
    return {
      ...common,
      state: completedRanges ? "RUNNING" : "QUEUED",
      stage: completedRanges ? "Shopling overlap 주문행 수집 중" : "예약 Worker 대기",
      message: `${completedRanges}/${request.ranges.length}개 7일 source range를 읽었습니다.`,
    };
  }
  if (combined.unmappedRows || combined.conflictExternalIds.length) {
    return {
      ...common,
      state: "BLOCKED",
      stage: "Source identity 검토 필요",
      message: `미연결 ${combined.unmappedRows}건 · identity/time 충돌 ${combined.conflictExternalIds.length}건으로 verify를 차단했습니다.`,
    };
  }
  return {
    ...common,
    state: "RUNNING",
    stage: "Product Master persisted exact-event 대조 중",
    message: `${verifiedBatches}/${candidateBatchCount}개 verify batch를 읽기 전용으로 대조했습니다.`,
  };
}

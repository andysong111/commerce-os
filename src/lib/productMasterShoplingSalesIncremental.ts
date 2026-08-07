import { createHash } from "node:crypto";
import {
  aggregateProductMasterShoplingSalesChunk,
  combineProductMasterShoplingSalesChunks,
  type ProductMasterShoplingSalesChunk,
} from "@/lib/productMasterShoplingSalesBackfillEngine";
import { loadProductMasterShoplingSalesStatus } from "@/lib/productMasterShoplingSalesBackfill";
import {
  SHOPLING_CANONICAL_SALES_SOURCE,
  buildShoplingIncrementalReconcilePlan,
  buildShoplingIncrementalWindow,
  exactShoplingIncrementalSales,
  type IncrementalPlanningRow,
  type IncrementalSalesSnapshotRow,
  type IncrementalWriteRow,
} from "@/lib/productMasterShoplingSalesIncrementalEngine";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
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

export const PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_REQUEST =
  "PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_REQUEST";
export const PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_CHUNK =
  "PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_CHUNK";
export const PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_STEP_FAILURE =
  "PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_STEP_FAILURE";
export const PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_WRITE_BATCH =
  "PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_WRITE_BATCH";
export const PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_FAILED =
  "PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_FAILED";
export const PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_SUCCESS =
  "PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_SUCCESS";

export const PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_DEFAULT_CHUNK_DAYS = 7;
export const PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_MINIMUM_CHUNK_DAYS = 2;
export const PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_SUCCESS_INTERVAL_MS =
  6 * 60 * 60 * 1000;
export const PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_FAILURE_RETRY_MS =
  60 * 60 * 1000;

const DEFAULT_PRODUCT_MASTER_URL =
  "https://commerce-os-product-master.vercel.app";
const MAX_STEP_ATTEMPTS = 3;
const OPERATION_LIMIT = 500;
const APPLY_BATCH_SIZE = 500;
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

type IncrementalRequest = {
  requestId: string;
  startDate: string;
  endDate: string;
  months: string[];
  chunkDays: number;
  mappingFingerprint: string;
  supersedesRequestId: string | null;
  ranges: ShoplingDateRange[];
  createdAt: string;
};

type SalesSnapshot = {
  rows: IncrementalSalesSnapshotRow[];
  sourceCounts: Record<string, number>;
};

type IncrementalFailureKind =
  | "RANGE_RETRY_EXHAUSTED"
  | "MAPPING_CHANGED"
  | "UNMAPPED"
  | "BLOCKERS"
  | "WRITE"
  | "VERIFY"
  | "UNKNOWN";

type IncrementalTerminal = {
  kind: "SUCCESS" | "FAILED";
  requestId: string;
  occurredAt: string;
  failureKind: IncrementalFailureKind | null;
  message: string;
};

export type ProductMasterShoplingSalesIncrementalStatus = {
  configured: boolean;
  baselineState: string;
  requestId: string | null;
  state:
    | "WAITING_BASELINE"
    | "IDLE"
    | "QUEUED"
    | "RUNNING"
    | "COMPLETED"
    | "FAILED";
  stage: string;
  message: string;
  startDate: string | null;
  endDate: string | null;
  months: string[];
  chunkDays: number;
  completedRanges: number;
  totalRanges: number;
  progress: number;
  fetchedRows: number;
  acceptedRows: number;
  unmappedRows: number;
  monthlyRowCount: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  error: string | null;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function managedBarcode(value: unknown) {
  const barcode = text(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\s+/g, "");
  return MANAGED_BARCODE.test(barcode) ? barcode : "";
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

function rangeKey(range: ShoplingDateRange) {
  return `${range.start}:${range.end}`;
}

function correlationId(requestId: string) {
  return `product-master-shopling-sales-incremental:${requestId}`;
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

export function productMasterShoplingSalesIncrementalConfigured() {
  try {
    shoplingReadConfigFromEnv(shoplingEnvironment());
    productMasterConnection();
    supabaseConnection();
    return true;
  } catch {
    return false;
  }
}

function mappingFingerprint(
  products: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>["products"],
) {
  const normalized = products
    .filter((product) => Boolean(managedBarcode(product.barcode)))
    .map((product) => ({
      skuId: text(product.skuId),
      barcode: managedBarcode(product.barcode),
      skuActive: product.skuActive !== false,
      listings: (product.listings ?? [])
        .map((listing) => ({
          goodsKey: text(listing.goodsKey),
          optionId: text(listing.optionId),
          unitsPerOrder: Math.max(
            1,
            Math.round(numeric(listing.unitsPerOrder)) || 1,
          ),
          active: listing.active !== false,
        }))
        .sort((left, right) =>
          `${left.goodsKey}\u0000${left.optionId}\u0000${left.unitsPerOrder}\u0000${left.active}`.localeCompare(
            `${right.goodsKey}\u0000${right.optionId}\u0000${right.unitsPerOrder}\u0000${right.active}`,
          ),
        ),
    }))
    .sort((left, right) =>
      `${left.barcode}\u0000${left.skuId}`.localeCompare(
        `${right.barcode}\u0000${right.skuId}`,
      ),
    );
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex")}`;
}

function planningRows(
  planning: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>,
): IncrementalPlanningRow[] {
  return planning.products.map((product) => ({
    skuId: text(product.skuId),
    barcode: text(product.barcode),
    skuActive: product.skuActive,
  }));
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
          source: "ops-center-product-master-shopling-sales-incremental",
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
      `PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
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
  if (requestCorrelationId) {
    query = query.eq("correlation_id", requestCorrelationId);
  }
  const result = await query.order("started_at", { ascending: false }).limit(limit);
  if (result.error) throw new Error(result.error.message);
  return (Array.isArray(result.data) ? result.data : []) as OperationRow[];
}

export async function createProductMasterShoplingSalesIncrementalRequest(options: {
  chunkDays?: number;
  supersedesRequestId?: string | null;
  now?: Date;
} = {}) {
  const baseline = await loadProductMasterShoplingSalesStatus();
  if (baseline.state !== "COMPLETED") {
    throw new Error(
      `PRODUCT_MASTER_SALES_INCREMENTAL_BASELINE_REQUIRED:${baseline.state}`,
    );
  }
  shoplingReadConfigFromEnv(shoplingEnvironment());
  productMasterConnection();
  const planning = await loadProductPlanningSnapshot();
  const now = options.now ?? new Date();
  const window = buildShoplingIncrementalWindow(now, 3);
  const chunkDays = Math.max(
    1,
    Math.min(
      31,
      Math.round(
        options.chunkDays ??
          PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_DEFAULT_CHUNK_DAYS,
      ),
    ),
  );
  const request: IncrementalRequest = {
    requestId: crypto.randomUUID(),
    startDate: window.startDate,
    endDate: window.endDate,
    months: window.months,
    chunkDays,
    mappingFingerprint: mappingFingerprint(planning.products),
    supersedesRequestId: text(options.supersedesRequestId) || null,
    ranges: splitShoplingDateRange(
      window.startDate,
      window.endDate,
      chunkDays,
    ),
    createdAt: now.toISOString(),
  };
  await storeOperation({
    operationType: PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_REQUEST,
    sourceEventId: `product-master-shopling-sales-incremental-request:${request.requestId}`,
    correlationId: correlationId(request.requestId),
    inputSnapshot: request,
    resultSnapshot: { accepted: true, state: "QUEUED" },
    occurredAt: request.createdAt,
  });
  return request;
}

function requestFromRow(row: OperationRow): IncrementalRequest | null {
  const value = object(row.input_snapshot);
  const ranges = Array.isArray(value.ranges)
    ? value.ranges
        .map(object)
        .map((range) => ({ start: text(range.start), end: text(range.end) }))
        .filter((range) => validDate(range.start) && validDate(range.end))
    : [];
  const months = Array.isArray(value.months)
    ? value.months.map(text).filter((month) => /^\d{4}-\d{2}$/.test(month))
    : [];
  const requestId = text(value.requestId);
  const createdAt = iso(value.createdAt);
  const fingerprint = text(value.mappingFingerprint);
  if (
    !requestId ||
    !createdAt ||
    !ranges.length ||
    !months.length ||
    !/^sha256:[a-f0-9]{64}$/.test(fingerprint)
  ) {
    return null;
  }
  return {
    requestId,
    startDate: text(value.startDate),
    endDate: text(value.endDate),
    months,
    chunkDays: Math.max(1, Math.round(numeric(value.chunkDays)) || 1),
    mappingFingerprint: fingerprint,
    supersedesRequestId: text(value.supersedesRequestId) || null,
    ranges,
    createdAt,
  };
}

function chunkFromRow(row: OperationRow): ProductMasterShoplingSalesChunk | null {
  const value = object(row.result_snapshot);
  const range = object(value.range);
  if (!validDate(text(range.start)) || !validDate(text(range.end))) return null;
  const monthlyRows = Array.isArray(value.monthlyRows)
    ? value.monthlyRows.map(object).map((sales) => ({
        id: text(sales.id),
        barcode: text(sales.barcode),
        month: text(sales.month),
        quantity: Math.max(0, Math.round(numeric(sales.quantity))),
        revenue: Math.max(0, Math.round(numeric(sales.revenue))),
        lastSaleAt: iso(sales.lastSaleAt),
        source: SHOPLING_CANONICAL_SALES_SOURCE,
      }))
    : [];
  const unmappedSamples = Array.isArray(value.unmappedSamples)
    ? value.unmappedSamples.map(object).map((sample) => ({
        orderLineId: text(sample.orderLineId),
        orderNo: text(sample.orderNo),
        orderedAt: text(sample.orderedAt),
        optionId: text(sample.optionId) || null,
        productId: text(sample.productId) || null,
        mallProductKey: text(sample.mallProductKey) || null,
        managedCode: text(sample.managedCode) || null,
        status: text(sample.status),
      }))
    : [];
  return {
    range: { start: text(range.start), end: text(range.end) },
    fetchedRows: Math.max(0, Math.round(numeric(value.fetchedRows))),
    acceptedRows: Math.max(0, Math.round(numeric(value.acceptedRows))),
    ignoredRows: Math.max(0, Math.round(numeric(value.ignoredRows))),
    unmappedRows: Math.max(0, Math.round(numeric(value.unmappedRows))),
    duplicateRows: Math.max(0, Math.round(numeric(value.duplicateRows))),
    totalBaseUnits: Math.max(0, Math.round(numeric(value.totalBaseUnits))),
    totalRevenue: Math.max(0, Math.round(numeric(value.totalRevenue))),
    monthlyRows,
    unmappedSamples,
  };
}

async function latestRequest() {
  const rows = await readOperations(
    PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_REQUEST,
    undefined,
    20,
  );
  for (const row of rows) {
    const request = requestFromRow(row);
    if (request) return request;
  }
  return null;
}

async function activeContext() {
  const request = await latestRequest();
  if (!request) return null;
  const cid = correlationId(request.requestId);
  const [chunks, failures, failed, successes] = await Promise.all([
    readOperations(PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_CHUNK, cid),
    readOperations(
      PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_STEP_FAILURE,
      cid,
    ),
    readOperations(PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_FAILED, cid, 5),
    readOperations(PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_SUCCESS, cid, 5),
  ]);
  return { request, cid, chunks, failures, failed, successes };
}

function failureAttempt(row: OperationRow) {
  const value = object(row.input_snapshot);
  return {
    rangeKey: text(value.rangeKey),
    attempt: Math.max(0, Math.round(numeric(value.attempt))),
    message: safeMessage(
      row.error_message || object(row.result_snapshot).message,
    ),
  };
}

function failureKind(row: OperationRow): IncrementalFailureKind {
  const result = object(row.result_snapshot);
  const raw = text(result.failureKind);
  if (
    [
      "RANGE_RETRY_EXHAUSTED",
      "MAPPING_CHANGED",
      "UNMAPPED",
      "BLOCKERS",
      "WRITE",
      "VERIFY",
    ].includes(raw)
  ) {
    return raw as IncrementalFailureKind;
  }
  return "UNKNOWN";
}

async function latestTerminal(): Promise<IncrementalTerminal | null> {
  const [successes, failures] = await Promise.all([
    readOperations(
      PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_SUCCESS,
      undefined,
      1,
    ),
    readOperations(
      PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_FAILED,
      undefined,
      1,
    ),
  ]);
  const candidates: IncrementalTerminal[] = [];
  const success = successes[0];
  if (success) {
    const result = object(success.result_snapshot);
    const occurredAt = iso(success.started_at);
    if (occurredAt) {
      candidates.push({
        kind: "SUCCESS",
        requestId: text(
          result.requestId || object(success.input_snapshot).requestId,
        ),
        occurredAt,
        failureKind: null,
        message:
          text(result.message) || "증분 판매원장 동기화를 완료했습니다.",
      });
    }
  }
  const failure = failures[0];
  if (failure) {
    const occurredAt = iso(failure.started_at);
    if (occurredAt) {
      candidates.push({
        kind: "FAILED",
        requestId: text(object(failure.input_snapshot).requestId),
        occurredAt,
        failureKind: failureKind(failure),
        message: safeMessage(
          failure.error_message || object(failure.result_snapshot).message,
        ),
      });
    }
  }
  return (
    candidates.sort(
      (left, right) =>
        Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
    )[0] ?? null
  );
}

async function loadProductMasterSalesSnapshot(): Promise<SalesSnapshot> {
  const { baseUrl, secret } = productMasterConnection();
  const response = await fetch(
    `${baseUrl}/api/integrations/sales-ledger-snapshot`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-commerce-os-integration-secret": secret,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    rows?: IncrementalSalesSnapshotRow[];
    sourceCounts?: Record<string, number>;
    message?: string;
  };
  if (!response.ok || payload.ok !== true || !Array.isArray(payload.rows)) {
    throw new Error(
      payload.message ||
        `PRODUCT_MASTER_SALES_INCREMENTAL_SNAPSHOT_FAILED:${response.status}`,
    );
  }
  return { rows: payload.rows, sourceCounts: payload.sourceCounts ?? {} };
}

async function pushSales(rows: IncrementalWriteRow[]) {
  if (!rows.length) return;
  const { baseUrl, secret } = productMasterConnection();
  const syncedAt = new Date().toISOString();
  const response = await fetch(`${baseUrl}/api/integrations/barcode-ledgers`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-commerce-os-integration-secret": secret,
    },
    body: JSON.stringify({
      salesMonthly: rows.map((row) => ({
        id: row.id,
        barcode: row.barcode,
        month: row.month,
        quantity: row.quantity,
        revenue: row.revenue,
        lastSaleAt: row.lastSaleAt,
        source: row.source,
        syncedAt,
      })),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
    error?: string;
  };
  if (!response.ok || payload.ok !== true) {
    throw new Error(
      payload.message ||
        payload.error ||
        `PRODUCT_MASTER_SALES_INCREMENTAL_WRITE_FAILED:${response.status}`,
    );
  }
}

async function failRequest(input: {
  context: NonNullable<Awaited<ReturnType<typeof activeContext>>>;
  failureKind: IncrementalFailureKind;
  message: string;
}) {
  await storeOperation({
    operationType: PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_FAILED,
    sourceEventId: `product-master-shopling-sales-incremental-failed:${input.context.request.requestId}`,
    correlationId: input.context.cid,
    status: "FAILED",
    inputSnapshot: { requestId: input.context.request.requestId },
    resultSnapshot: {
      state: "FAILED",
      failureKind: input.failureKind,
      message: input.message,
    },
    errorMessage: input.message,
  });
  return {
    processed: false,
    state: "FAILED" as const,
    failureKind: input.failureKind,
    message: input.message,
  };
}

export async function runProductMasterShoplingSalesIncrementalStep() {
  const context = await activeContext();
  if (!context) {
    return {
      processed: false,
      state: "IDLE" as const,
      message: "증분 판매원장 요청이 없습니다.",
    };
  }
  if (context.successes.length) {
    return {
      processed: false,
      state: "COMPLETED" as const,
      message: "증분 판매원장 동기화가 이미 완료되었습니다.",
    };
  }
  if (context.failed.length) {
    return {
      processed: false,
      state: "FAILED" as const,
      message: safeMessage(
        context.failed[0].error_message ||
          object(context.failed[0].result_snapshot).message,
      ),
    };
  }

  const chunks = context.chunks
    .map(chunkFromRow)
    .filter(Boolean) as ProductMasterShoplingSalesChunk[];
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
      return failRequest({
        context,
        failureKind: "RANGE_RETRY_EXHAUSTED",
        message: `${key} Shopling 주문 증분 조회가 ${MAX_STEP_ATTEMPTS}회 실패했습니다. 최종 원인: ${attempts[0]?.message || "확인 필요"}`,
      });
    }

    try {
      const planning = await loadProductPlanningSnapshot();
      if (
        mappingFingerprint(planning.products) !==
        context.request.mappingFingerprint
      ) {
        return failRequest({
          context,
          failureKind: "MAPPING_CHANGED",
          message:
            "증분 판매원장 수집 중 상품마스터 Shopling 연결구조가 바뀌어 서로 다른 기준을 섞지 않도록 종료했습니다.",
        });
      }
      const config = shoplingReadConfigFromEnv(shoplingEnvironment());
      const rows = await new ShoplingReadClient(config).read("orders", nextRange);
      const result = aggregateProductMasterShoplingSalesChunk(
        rows,
        planning,
        nextRange,
      );
      await storeOperation({
        operationType: PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_CHUNK,
        sourceEventId: `product-master-shopling-sales-incremental-chunk:${context.request.requestId}:${key}`,
        correlationId: context.cid,
        inputSnapshot: {
          requestId: context.request.requestId,
          range: nextRange,
          rangeKey: key,
          chunkDays: context.request.chunkDays,
        },
        resultSnapshot: result,
      });
      return {
        processed: true,
        state: "RUNNING" as const,
        phase: "READ" as const,
        range: nextRange,
        fetchedRows: result.fetchedRows,
        acceptedRows: result.acceptedRows,
        unmappedRows: result.unmappedRows,
        message: `${key} Shopling 주문 증분 데이터를 읽었습니다.`,
      };
    } catch (error) {
      const attempt = attempts.length + 1;
      const message = safeMessage(error);
      await storeOperation({
        operationType: PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_STEP_FAILURE,
        sourceEventId: `product-master-shopling-sales-incremental-step-failure:${context.request.requestId}:${key}:${attempt}`,
        correlationId: context.cid,
        status: "FAILED",
        inputSnapshot: {
          requestId: context.request.requestId,
          range: nextRange,
          rangeKey: key,
          chunkDays: context.request.chunkDays,
          attempt,
        },
        resultSnapshot: { state: "RETRY_PENDING", message },
        errorMessage: message,
      });
      return {
        processed: false,
        state: "RUNNING" as const,
        phase: "READ_RETRY" as const,
        retryPending: true,
        attempt,
        range: nextRange,
        message,
      };
    }
  }

  const planning = await loadProductPlanningSnapshot();
  if (
    mappingFingerprint(planning.products) !== context.request.mappingFingerprint
  ) {
    return failRequest({
      context,
      failureKind: "MAPPING_CHANGED",
      message:
        "증분 판매원장 쓰기 직전 상품마스터 Shopling 연결구조가 바뀌어 자동 갱신을 중단했습니다.",
    });
  }

  const combined = combineProductMasterShoplingSalesChunks(chunks);
  if (combined.unmappedRows > 0) {
    return failRequest({
      context,
      failureKind: "UNMAPPED",
      message: `최근 증분 주문 중 ${combined.unmappedRows}건을 현재 상품마스터 SKU로 안전하게 연결하지 못해 전체 갱신을 차단했습니다.`,
    });
  }

  const existing = await loadProductMasterSalesSnapshot();
  const plan = buildShoplingIncrementalReconcilePlan({
    freshRows: combined.rows,
    existingRows: existing.rows,
    planningRows: planningRows(planning),
    months: context.request.months,
  });
  if (plan.blockers.length) {
    return failRequest({
      context,
      failureKind: "BLOCKERS",
      message: `증분 판매원장 안전검증에서 ${plan.blockers.length}건이 차단되어 상품마스터를 변경하지 않았습니다. 첫 사유: ${plan.blockers[0]?.message || "확인 필요"}`,
    });
  }

  const existingById = new Map(existing.rows.map((row) => [row.id, row]));
  const pending = plan.writeRows.filter((row) => {
    const current = existingById.get(row.id);
    return !current || !exactShoplingIncrementalSales(row, current);
  });

  if (pending.length) {
    const batch = pending.slice(0, APPLY_BATCH_SIZE);
    try {
      await pushSales(batch);
      await storeOperation({
        operationType: PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_WRITE_BATCH,
        sourceEventId: `product-master-shopling-sales-incremental-write:${context.request.requestId}:${batch[0]?.id}:${batch.length}`,
        correlationId: context.cid,
        inputSnapshot: {
          requestId: context.request.requestId,
          batchCount: batch.length,
          pendingBeforeWrite: pending.length,
        },
        resultSnapshot: {
          written: batch.length,
          retryIsIdempotent: true,
        },
      });
      return {
        processed: true,
        state: "RUNNING" as const,
        phase: "WRITE" as const,
        written: batch.length,
        remaining: Math.max(0, pending.length - batch.length),
        message: `증분 월 판매원장 ${batch.length}건을 멱등 갱신했습니다.`,
      };
    } catch (error) {
      return failRequest({
        context,
        failureKind: "WRITE",
        message: safeMessage(error),
      });
    }
  }

  const verified = await loadProductMasterSalesSnapshot();
  const verifiedById = new Map(verified.rows.map((row) => [row.id, row]));
  const missing = plan.writeRows.filter((row) => {
    const current = verifiedById.get(row.id);
    return !current || !exactShoplingIncrementalSales(row, current);
  });
  if (missing.length) {
    return failRequest({
      context,
      failureKind: "VERIFY",
      message: `증분 판매원장 재조회 검증에서 ${missing.length}건이 일치하지 않아 완료 처리하지 않았습니다.`,
    });
  }

  const occurredAt = new Date().toISOString();
  const message = `최근 ${context.request.months.length}개 달 Shopling 판매원장 ${plan.writeRows.length}건을 자동 재계산·검증했습니다.`;
  await storeOperation({
    operationType: PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_SUCCESS,
    sourceEventId: `product-master-shopling-sales-incremental-success:${context.request.requestId}`,
    correlationId: context.cid,
    inputSnapshot: {
      requestId: context.request.requestId,
      startDate: context.request.startDate,
      endDate: context.request.endDate,
      months: context.request.months,
    },
    resultSnapshot: {
      requestId: context.request.requestId,
      state: "COMPLETED",
      message,
      fetchedRows: combined.fetchedRows,
      acceptedRows: combined.acceptedRows,
      ignoredRows: combined.ignoredRows,
      duplicateRows: combined.duplicateRows,
      totalBaseUnits: combined.totalBaseUnits,
      monthlyRowCount: combined.monthlyRowCount,
      writeRows: plan.writeRows.length,
      zeroRows: plan.zeroRows.length,
      verified: true,
    },
    occurredAt,
  });
  return {
    processed: true,
    state: "COMPLETED" as const,
    phase: "VERIFY" as const,
    message,
  };
}

export async function ensureProductMasterShoplingSalesIncrementalRequest(options: {
  now?: Date;
} = {}) {
  const now = options.now ?? new Date();
  const baseline = await loadProductMasterShoplingSalesStatus();
  if (baseline.state !== "COMPLETED") {
    return {
      created: false,
      state: "WAITING_BASELINE" as const,
      message: `최초 24개월 판매원장 상태가 ${baseline.state}라 증분 동기화를 시작하지 않습니다.`,
    };
  }

  const context = await activeContext();
  if (context && !context.successes.length && !context.failed.length) {
    return {
      created: false,
      state: "RUNNING" as const,
      requestId: context.request.requestId,
      message: "기존 증분 판매원장 작업을 이어서 처리합니다.",
    };
  }

  const terminal = await latestTerminal();
  if (terminal) {
    const age = now.getTime() - Date.parse(terminal.occurredAt);
    if (
      terminal.kind === "SUCCESS" &&
      age < PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_SUCCESS_INTERVAL_MS
    ) {
      return {
        created: false,
        state: "IDLE" as const,
        lastSuccessAt: terminal.occurredAt,
        message:
          "최근 증분 동기화 후 6시간이 지나지 않아 새 전수 재계산을 생략합니다.",
      };
    }
    if (terminal.kind === "FAILED") {
      const failedRequest = context?.request;
      if (
        terminal.failureKind === "RANGE_RETRY_EXHAUSTED" &&
        failedRequest &&
        failedRequest.chunkDays >
          PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_MINIMUM_CHUNK_DAYS
      ) {
        const created = await createProductMasterShoplingSalesIncrementalRequest({
          chunkDays: PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_MINIMUM_CHUNK_DAYS,
          supersedesRequestId: failedRequest.requestId,
          now,
        });
        return {
          created: true,
          state: "QUEUED" as const,
          requestId: created.requestId,
          message:
            "7일 증분 주문 조회 실패를 종료하고 2일 단위로 안전 재접수했습니다.",
        };
      }
      if (
        age < PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_FAILURE_RETRY_MS
      ) {
        return {
          created: false,
          state: "FAILED" as const,
          lastFailureAt: terminal.occurredAt,
          message: `최근 증분 동기화 실패 후 1시간 보호대기 중입니다. ${terminal.message}`,
        };
      }
    }
  }

  const created = await createProductMasterShoplingSalesIncrementalRequest({
    chunkDays: PRODUCT_MASTER_SHOPLING_SALES_INCREMENTAL_DEFAULT_CHUNK_DAYS,
    supersedesRequestId: context?.request.requestId ?? null,
    now,
  });
  return {
    created: true,
    state: "QUEUED" as const,
    requestId: created.requestId,
    message: "최근 4개 달 Shopling 판매원장 증분 재계산을 접수했습니다.",
  };
}

export async function loadProductMasterShoplingSalesIncrementalStatus(): Promise<ProductMasterShoplingSalesIncrementalStatus> {
  const configured = productMasterShoplingSalesIncrementalConfigured();
  const baseline = await loadProductMasterShoplingSalesStatus();
  const terminal = await latestTerminal();
  const context = await activeContext();
  const lastSuccessAt =
    terminal?.kind === "SUCCESS" ? terminal.occurredAt : null;
  const lastFailureAt = terminal?.kind === "FAILED" ? terminal.occurredAt : null;

  const empty: ProductMasterShoplingSalesIncrementalStatus = {
    configured,
    baselineState: baseline.state,
    requestId: null,
    state: baseline.state === "COMPLETED" ? "IDLE" : "WAITING_BASELINE",
    stage:
      baseline.state === "COMPLETED"
        ? "증분 동기화 대기"
        : "최초 판매원장 대기",
    message:
      baseline.state === "COMPLETED"
        ? "최초 24개월 판매원장이 완료되었습니다. 증분 동기화 주기를 기다립니다."
        : `최초 24개월 판매원장 상태가 ${baseline.state}입니다.`,
    startDate: null,
    endDate: null,
    months: [],
    chunkDays: 0,
    completedRanges: 0,
    totalRanges: 0,
    progress: 0,
    fetchedRows: 0,
    acceptedRows: 0,
    unmappedRows: 0,
    monthlyRowCount: 0,
    lastSuccessAt,
    lastFailureAt,
    error: terminal?.kind === "FAILED" ? terminal.message : null,
  };
  if (!context) return empty;

  const chunks = context.chunks
    .map(chunkFromRow)
    .filter(Boolean) as ProductMasterShoplingSalesChunk[];
  const completedRanges = new Set(
    chunks.map((chunk) => rangeKey(chunk.range)),
  ).size;
  const totalRanges = context.request.ranges.length;
  const combined = combineProductMasterShoplingSalesChunks(chunks);
  const common = {
    ...empty,
    requestId: context.request.requestId,
    startDate: context.request.startDate,
    endDate: context.request.endDate,
    months: context.request.months,
    chunkDays: context.request.chunkDays,
    completedRanges,
    totalRanges,
    progress: totalRanges
      ? Math.min(100, Math.round((completedRanges / totalRanges) * 100))
      : 0,
    fetchedRows: combined.fetchedRows,
    acceptedRows: combined.acceptedRows,
    unmappedRows: combined.unmappedRows,
    monthlyRowCount: combined.monthlyRowCount,
  };

  if (context.failed.length) {
    const error = safeMessage(
      context.failed[0].error_message ||
        object(context.failed[0].result_snapshot).message,
    );
    return {
      ...common,
      state: "FAILED",
      stage: "증분 동기화 실패",
      message: error,
      error,
    };
  }
  if (context.successes.length) {
    return {
      ...common,
      state: "COMPLETED",
      stage: "증분 동기화 완료",
      message:
        text(object(context.successes[0].result_snapshot).message) ||
        "증분 판매원장 동기화를 완료했습니다.",
      progress: 100,
    };
  }
  return {
    ...common,
    state: completedRanges ? "RUNNING" : "QUEUED",
    stage: completedRanges ? "최근 주문 증분 수집 중" : "예약 Worker 대기",
    message: `${completedRanges}/${totalRanges}개 증분 기간 구간을 처리했습니다.`,
  };
}

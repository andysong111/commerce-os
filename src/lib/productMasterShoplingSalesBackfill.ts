import { createHash } from "node:crypto";
import {
  aggregateProductMasterShoplingSalesChunk,
  combineProductMasterShoplingSalesChunks,
  type ProductMasterSalesMonthlyRow,
  type ProductMasterShoplingSalesChunk,
} from "@/lib/productMasterShoplingSalesBackfillEngine";
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

export const PRODUCT_MASTER_SHOPLING_SALES_REQUEST =
  "PRODUCT_MASTER_SHOPLING_SALES_REQUEST";
export const PRODUCT_MASTER_SHOPLING_SALES_CHUNK =
  "PRODUCT_MASTER_SHOPLING_SALES_CHUNK";
export const PRODUCT_MASTER_SHOPLING_SALES_STEP_FAILURE =
  "PRODUCT_MASTER_SHOPLING_SALES_STEP_FAILURE";
export const PRODUCT_MASTER_SHOPLING_SALES_FAILED =
  "PRODUCT_MASTER_SHOPLING_SALES_FAILED";
export const PRODUCT_MASTER_SHOPLING_SALES_REPORT =
  "PRODUCT_MASTER_SHOPLING_SALES_REPORT";
export const PRODUCT_MASTER_SHOPLING_SALES_CANARY =
  "PRODUCT_MASTER_SHOPLING_SALES_CANARY";
export const PRODUCT_MASTER_SHOPLING_SALES_FULL =
  "PRODUCT_MASTER_SHOPLING_SALES_FULL";

export const PRODUCT_MASTER_SHOPLING_SALES_DEFAULT_CHUNK_DAYS = 30;
export const PRODUCT_MASTER_SHOPLING_SALES_FALLBACK_CHUNK_DAYS = 7;
export const PRODUCT_MASTER_SHOPLING_SALES_MINIMUM_CHUNK_DAYS = 2;

const DEFAULT_PRODUCT_MASTER_URL =
  "https://commerce-os-product-master.vercel.app";
const DEFAULT_MONTHS = 24;
const MAX_STEP_ATTEMPTS = 3;
const OPERATION_LIMIT = 500;
const APPLY_BATCH_SIZE = 500;
const SALES_SOURCE = "shopling_orders_24m_v1";
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

type SalesBackfillRequest = {
  requestId: string;
  startDate: string;
  endDate: string;
  chunkDays: number;
  mappingFingerprint: string;
  supersedesRequestId: string | null;
  ranges: ShoplingDateRange[];
  createdAt: string;
};

type SalesReport = {
  generatedAt: string;
  fetchedRows: number;
  acceptedRows: number;
  ignoredRows: number;
  unmappedRows: number;
  duplicateRows: number;
  totalBaseUnits: number;
  totalRevenue: number;
  monthlyRowCount: number;
  barcodeCount: number;
  months: string[];
  unmappedSamples: Array<Record<string, unknown>>;
};

type SalesSnapshotRow = {
  id: string;
  skuId: string;
  month: string;
  quantity: number;
  revenue: number;
  lastSaleAt: string | null;
  source: string;
  syncedAt: string | null;
};

type SalesSnapshot = {
  rows: SalesSnapshotRow[];
  sourceCounts: Record<string, number>;
};

type ApplyRow = ProductMasterSalesMonthlyRow & { skuId: string };

type ApplyBlocker = {
  code: "SKU_NOT_CURRENT" | "TARGET_ROW_CONFLICT" | "LEGACY_MONTH_OVERLAP";
  barcode: string;
  skuId: string | null;
  month: string;
  message: string;
};

type ApplyPlan = {
  totalRows: number;
  safeRows: ApplyRow[];
  alreadyApplied: ApplyRow[];
  pending: ApplyRow[];
  blockers: ApplyBlocker[];
};

export type ProductMasterShoplingSalesStatus = {
  configured: boolean;
  requestId: string | null;
  state:
    | "IDLE"
    | "QUEUED"
    | "RUNNING"
    | "BLOCKED"
    | "READY_CANARY"
    | "READY_FULL"
    | "COMPLETED"
    | "FAILED";
  stage: string;
  message: string;
  progress: number;
  completedRanges: number;
  totalRanges: number;
  fetchedRows: number;
  acceptedRows: number;
  unmappedRows: number;
  monthlyRowCount: number;
  safeRowCount: number;
  alreadyAppliedCount: number;
  pendingCount: number;
  blockerCount: number;
  canaryVerified: boolean;
  chunkDays: number;
  report: SalesReport | null;
  blockers: ApplyBlocker[];
  error: string | null;
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

function managedBarcode(value: unknown) {
  const barcode = text(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/\s+/g, "");
  return MANAGED_BARCODE.test(barcode) ? barcode : "";
}

function validDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function rangeKey(range: ShoplingDateRange) {
  return `${range.start}:${range.end}`;
}

function correlationId(requestId: string) {
  return `product-master-shopling-sales:${requestId}`;
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
            Math.round(number(listing.unitsPerOrder)) || 1,
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

export function productMasterShoplingSalesConfigured() {
  try {
    shoplingReadConfigFromEnv(shoplingEnvironment());
    productMasterConnection();
    supabaseConnection();
    return true;
  } catch {
    return false;
  }
}

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : text(error);
  return message
    .slice(0, 500)
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, "[redacted]");
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
          source: "ops-center-product-master-shopling-sales",
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
      `PRODUCT_MASTER_SHOPLING_SALES_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
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

function recentStart(now: Date) {
  return dateOnly(
    new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() - (DEFAULT_MONTHS - 1),
        1,
      ),
    ),
  );
}

export async function createProductMasterShoplingSalesRequest(options: {
  chunkDays?: number;
  supersedesRequestId?: string | null;
  now?: Date;
} = {}) {
  shoplingReadConfigFromEnv(shoplingEnvironment());
  productMasterConnection();
  const planning = await loadProductPlanningSnapshot();
  const now = options.now ?? new Date();
  const chunkDays = Math.max(
    1,
    Math.min(
      31,
      Math.round(
        options.chunkDays ?? PRODUCT_MASTER_SHOPLING_SALES_DEFAULT_CHUNK_DAYS,
      ),
    ),
  );
  const request: SalesBackfillRequest = {
    requestId: crypto.randomUUID(),
    startDate: recentStart(now),
    endDate: dateOnly(now),
    chunkDays,
    mappingFingerprint: mappingFingerprint(planning.products),
    supersedesRequestId: text(options.supersedesRequestId) || null,
    ranges: splitShoplingDateRange(
      recentStart(now),
      dateOnly(now),
      chunkDays,
    ),
    createdAt: now.toISOString(),
  };
  await storeOperation({
    operationType: PRODUCT_MASTER_SHOPLING_SALES_REQUEST,
    sourceEventId: `product-master-shopling-sales-request:${request.requestId}`,
    correlationId: correlationId(request.requestId),
    inputSnapshot: request,
    resultSnapshot: { accepted: true, state: "QUEUED" },
    occurredAt: request.createdAt,
  });
  return request;
}

function requestFromRow(row: OperationRow): SalesBackfillRequest | null {
  const value = object(row.input_snapshot);
  const ranges = Array.isArray(value.ranges)
    ? value.ranges
        .map(object)
        .map((range) => ({ start: text(range.start), end: text(range.end) }))
        .filter((range) => validDate(range.start) && validDate(range.end))
    : [];
  const requestId = text(value.requestId);
  const createdAt = iso(value.createdAt);
  const fingerprint = text(value.mappingFingerprint);
  if (
    !requestId ||
    !createdAt ||
    !ranges.length ||
    !/^sha256:[a-f0-9]{64}$/.test(fingerprint)
  ) {
    return null;
  }
  return {
    requestId,
    startDate: text(value.startDate),
    endDate: text(value.endDate),
    chunkDays: Math.max(1, Math.round(number(value.chunkDays)) || 1),
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
        quantity: Math.max(0, Math.round(number(sales.quantity))),
        revenue: Math.max(0, Math.round(number(sales.revenue))),
        lastSaleAt: iso(sales.lastSaleAt),
        source: SALES_SOURCE as "shopling_orders_24m_v1",
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
    fetchedRows: Math.max(0, Math.round(number(value.fetchedRows))),
    acceptedRows: Math.max(0, Math.round(number(value.acceptedRows))),
    ignoredRows: Math.max(0, Math.round(number(value.ignoredRows))),
    unmappedRows: Math.max(0, Math.round(number(value.unmappedRows))),
    duplicateRows: Math.max(0, Math.round(number(value.duplicateRows))),
    totalBaseUnits: Math.max(0, Math.round(number(value.totalBaseUnits))),
    totalRevenue: Math.max(0, Math.round(number(value.totalRevenue))),
    monthlyRows,
    unmappedSamples,
  };
}

function reportFromRow(row: OperationRow): SalesReport | null {
  const value = object(row.result_snapshot);
  const report = object(value.report);
  if (!text(report.generatedAt)) return null;
  return report as unknown as SalesReport;
}

async function latestRequest() {
  const rows = await readOperations(
    PRODUCT_MASTER_SHOPLING_SALES_REQUEST,
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
  const [chunks, failures, failedRuns, reports, canaries] = await Promise.all([
    readOperations(PRODUCT_MASTER_SHOPLING_SALES_CHUNK, cid),
    readOperations(PRODUCT_MASTER_SHOPLING_SALES_STEP_FAILURE, cid),
    readOperations(PRODUCT_MASTER_SHOPLING_SALES_FAILED, cid, 5),
    readOperations(PRODUCT_MASTER_SHOPLING_SALES_REPORT, cid, 5),
    readOperations(PRODUCT_MASTER_SHOPLING_SALES_CANARY, cid, 5),
  ]);
  return { request, cid, chunks, failures, failedRuns, reports, canaries };
}

function failureAttempt(row: OperationRow) {
  const value = object(row.input_snapshot);
  return {
    rangeKey: text(value.rangeKey),
    attempt: Math.max(0, Math.round(number(value.attempt))),
    message: safeMessage(
      row.error_message || object(row.result_snapshot).message,
    ),
  };
}

export async function runProductMasterShoplingSalesStep() {
  const context = await activeContext();
  if (!context) {
    return {
      processed: false,
      state: "IDLE",
      message: "판매원장 작업이 없습니다.",
    };
  }
  if (context.reports.some(reportFromRow)) {
    return {
      processed: false,
      state: "COMPLETED",
      message: "판매원장 읽기 진단이 이미 완료되었습니다.",
    };
  }
  if (context.failedRuns.length) {
    return {
      processed: false,
      state: "FAILED",
      message: "판매원장 읽기 진단이 실패 종료되었습니다.",
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
      const message = `${key} Shopling 주문 조회가 ${MAX_STEP_ATTEMPTS}회 실패했습니다. 최종 원인: ${attempts[0]?.message || "확인 필요"}`;
      await storeOperation({
        operationType: PRODUCT_MASTER_SHOPLING_SALES_FAILED,
        sourceEventId: `product-master-shopling-sales-failed:${context.request.requestId}`,
        correlationId: context.cid,
        status: "FAILED",
        inputSnapshot: {
          requestId: context.request.requestId,
          rangeKey: key,
          chunkDays: context.request.chunkDays,
        },
        resultSnapshot: { state: "FAILED", message },
        errorMessage: message,
      });
      return { processed: false, state: "FAILED", message };
    }

    try {
      const planning = await loadProductPlanningSnapshot();
      if (
        mappingFingerprint(planning.products) !==
        context.request.mappingFingerprint
      ) {
        throw new Error("PRODUCT_MASTER_SALES_MAPPING_CHANGED");
      }
      const config = shoplingReadConfigFromEnv(shoplingEnvironment());
      const rows = await new ShoplingReadClient(config).read("orders", nextRange);
      const result = aggregateProductMasterShoplingSalesChunk(
        rows,
        planning,
        nextRange,
      );
      await storeOperation({
        operationType: PRODUCT_MASTER_SHOPLING_SALES_CHUNK,
        sourceEventId: `product-master-shopling-sales-chunk:${context.request.requestId}:${key}`,
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
        state: "RUNNING",
        range: nextRange,
        fetchedRows: result.fetchedRows,
        acceptedRows: result.acceptedRows,
        unmappedRows: result.unmappedRows,
        message: `${key} Shopling 주문을 읽어 월 판매량 후보를 저장했습니다.`,
      };
    } catch (error) {
      const attempt = attempts.length + 1;
      const message = safeMessage(error);
      await storeOperation({
        operationType: PRODUCT_MASTER_SHOPLING_SALES_STEP_FAILURE,
        sourceEventId: `product-master-shopling-sales-step-failure:${context.request.requestId}:${key}:${attempt}`,
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
        state: "RUNNING",
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
    const message =
      "판매원장 수집 중 상품마스터 Shopling 연결구조가 변경되어 서로 다른 기준을 섞지 않도록 종료했습니다.";
    await storeOperation({
      operationType: PRODUCT_MASTER_SHOPLING_SALES_FAILED,
      sourceEventId: `product-master-shopling-sales-failed:${context.request.requestId}`,
      correlationId: context.cid,
      status: "FAILED",
      inputSnapshot: { requestId: context.request.requestId },
      resultSnapshot: { state: "FAILED", message },
      errorMessage: message,
    });
    return { processed: false, state: "FAILED", message };
  }

  const combined = combineProductMasterShoplingSalesChunks(chunks);
  const report: SalesReport = {
    generatedAt: new Date().toISOString(),
    fetchedRows: combined.fetchedRows,
    acceptedRows: combined.acceptedRows,
    ignoredRows: combined.ignoredRows,
    unmappedRows: combined.unmappedRows,
    duplicateRows: combined.duplicateRows,
    totalBaseUnits: combined.totalBaseUnits,
    totalRevenue: combined.totalRevenue,
    monthlyRowCount: combined.monthlyRowCount,
    barcodeCount: combined.barcodeCount,
    months: combined.months,
    unmappedSamples: combined.unmappedSamples,
  };
  await storeOperation({
    operationType: PRODUCT_MASTER_SHOPLING_SALES_REPORT,
    sourceEventId: `product-master-shopling-sales-report:${context.request.requestId}`,
    correlationId: context.cid,
    inputSnapshot: {
      requestId: context.request.requestId,
      rangeCount: context.request.ranges.length,
      chunkDays: context.request.chunkDays,
    },
    resultSnapshot: { report },
  });
  return {
    processed: true,
    state: "COMPLETED",
    report,
    message: "최근 24개월 Shopling 주문 읽기와 월 판매량 후보 계산을 완료했습니다.",
  };
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
    rows?: SalesSnapshotRow[];
    sourceCounts?: Record<string, number>;
    message?: string;
  };
  if (!response.ok || payload.ok !== true || !Array.isArray(payload.rows)) {
    throw new Error(
      payload.message || `PRODUCT_MASTER_SALES_SNAPSHOT_FAILED:${response.status}`,
    );
  }
  return { rows: payload.rows, sourceCounts: payload.sourceCounts ?? {} };
}

function exactSales(
  left: ProductMasterSalesMonthlyRow,
  right: SalesSnapshotRow,
) {
  return (
    left.id === right.id &&
    left.month === right.month &&
    left.quantity === Math.max(0, Math.round(number(right.quantity))) &&
    left.revenue === Math.max(0, Math.round(number(right.revenue))) &&
    (left.lastSaleAt ?? null) === (iso(right.lastSaleAt) ?? null) &&
    right.source === SALES_SOURCE
  );
}

function uniqueSkuByManagedBarcode(
  planning: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>,
) {
  const skuByBarcode = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const product of planning.products ?? []) {
    const barcode = managedBarcode(product.barcode);
    const skuId = text(product.skuId);
    if (!barcode || !skuId || ambiguous.has(barcode)) continue;
    const existing = skuByBarcode.get(barcode);
    if (existing && existing !== skuId) {
      skuByBarcode.delete(barcode);
      ambiguous.add(barcode);
      continue;
    }
    skuByBarcode.set(barcode, skuId);
  }
  return skuByBarcode;
}

function buildApplyPlan(
  rows: ProductMasterSalesMonthlyRow[],
  planning: Awaited<ReturnType<typeof loadProductPlanningSnapshot>>,
  existing: SalesSnapshot,
): ApplyPlan {
  // Historical B-code sales remain attached to their stable SKU even when
  // that SKU is now inactive. Product Master barcode-ledger import resolves
  // both current and historical barcodes to stable sku_id, so the apply gate
  // only requires one unambiguous B-code owner, not skuActive=true.
  const skuByBarcode = uniqueSkuByManagedBarcode(planning);
  const existingById = new Map(existing.rows.map((row) => [row.id, row]));
  const otherBySkuMonth = new Map<string, SalesSnapshotRow[]>();
  for (const row of existing.rows) {
    if (row.source === SALES_SOURCE) continue;
    const key = `${row.skuId}\u0000${row.month}`;
    otherBySkuMonth.set(key, [...(otherBySkuMonth.get(key) ?? []), row]);
  }

  const safeRows: ApplyRow[] = [];
  const alreadyApplied: ApplyRow[] = [];
  const pending: ApplyRow[] = [];
  const blockers: ApplyBlocker[] = [];
  for (const row of rows) {
    const barcode = managedBarcode(row.barcode);
    const skuId = barcode ? skuByBarcode.get(barcode) : null;
    if (!skuId) {
      blockers.push({
        code: "SKU_NOT_CURRENT",
        barcode: row.barcode,
        skuId: null,
        month: row.month,
        message:
          "판매원장 위치코드를 상품마스터의 고유 B코드 SKU에서 찾지 못했습니다.",
      });
      continue;
    }
    const resolved = { ...row, barcode, skuId };
    const current = existingById.get(row.id);
    if (current) {
      if (current.skuId === skuId && exactSales(row, current)) {
        safeRows.push(resolved);
        alreadyApplied.push(resolved);
      } else {
        blockers.push({
          code: "TARGET_ROW_CONFLICT",
          barcode,
          skuId,
          month: row.month,
          message:
            "같은 Shopling 판매원장 ID에 다른 값이 이미 있어 자동 덮어쓰기를 차단했습니다.",
        });
      }
      continue;
    }
    const overlaps = otherBySkuMonth.get(`${skuId}\u0000${row.month}`) ?? [];
    if (
      overlaps.some(
        (existingRow) => existingRow.quantity > 0 || existingRow.revenue > 0,
      )
    ) {
      blockers.push({
        code: "LEGACY_MONTH_OVERLAP",
        barcode,
        skuId,
        month: row.month,
        message:
          "같은 SKU·월에 다른 원천의 판매원장이 있어 이중계상 위험 때문에 자동 적재를 차단했습니다.",
      });
      continue;
    }
    safeRows.push(resolved);
    pending.push(resolved);
  }
  return {
    totalRows: rows.length,
    safeRows,
    alreadyApplied,
    pending,
    blockers,
  };
}

async function combinedRows(
  context: NonNullable<Awaited<ReturnType<typeof activeContext>>>,
) {
  const chunks = context.chunks
    .map(chunkFromRow)
    .filter(Boolean) as ProductMasterShoplingSalesChunk[];
  return combineProductMasterShoplingSalesChunks(chunks).rows;
}

function canaryVerified(
  context: NonNullable<Awaited<ReturnType<typeof activeContext>>>,
) {
  return context.canaries.some(
    (row) =>
      text(row.status) === "SUCCEEDED" &&
      object(row.result_snapshot).verified === true,
  );
}

async function pushSales(rows: ApplyRow[]) {
  if (!rows.length) return;
  const { baseUrl, secret } = productMasterConnection();
  const syncedAt = new Date().toISOString();
  const response = await fetch(
    `${baseUrl}/api/integrations/barcode-ledgers`,
    {
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
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
    error?: string;
  };
  if (!response.ok || payload.ok !== true) {
    throw new Error(
      payload.message ||
        payload.error ||
        `PRODUCT_MASTER_SALES_WRITE_FAILED:${response.status}`,
    );
  }
}

async function currentApplyPlan(
  context: NonNullable<Awaited<ReturnType<typeof activeContext>>>,
) {
  const planning = await loadProductPlanningSnapshot();
  if (
    mappingFingerprint(planning.products) !== context.request.mappingFingerprint
  ) {
    throw new Error("PRODUCT_MASTER_SALES_MAPPING_CHANGED");
  }
  const [rows, existing] = await Promise.all([
    combinedRows(context),
    loadProductMasterSalesSnapshot(),
  ]);
  return buildApplyPlan(rows, planning, existing);
}

export async function applyProductMasterShoplingSales(
  mode: "CANARY" | "FULL",
) {
  const context = await activeContext();
  if (!context) {
    throw new Error("PRODUCT_MASTER_SALES_DIAGNOSTIC_NOT_COMPLETED");
  }
  const report = context.reports.map(reportFromRow).find(Boolean);
  if (!report) throw new Error("PRODUCT_MASTER_SALES_DIAGNOSTIC_NOT_COMPLETED");
  if (report.unmappedRows > 0) {
    throw new Error(`PRODUCT_MASTER_SALES_BLOCKED:unmapped=${report.unmappedRows}`);
  }
  const plan = await currentApplyPlan(context);
  if (plan.blockers.length) {
    throw new Error(
      `PRODUCT_MASTER_SALES_BLOCKED:conflicts=${plan.blockers.length}`,
    );
  }
  if (mode === "FULL" && !canaryVerified(context)) {
    throw new Error("PRODUCT_MASTER_SALES_CANARY_REQUIRED");
  }
  const selected = mode === "CANARY" ? plan.pending.slice(0, 1) : plan.pending;
  if (!selected.length) {
    return {
      mode,
      applied: 0,
      verified: true,
      status: await loadProductMasterShoplingSalesStatus(),
    };
  }

  const operationType =
    mode === "CANARY"
      ? PRODUCT_MASTER_SHOPLING_SALES_CANARY
      : PRODUCT_MASTER_SHOPLING_SALES_FULL;
  const sourceEventId =
    mode === "CANARY"
      ? `product-master-shopling-sales-canary:${context.request.requestId}:${selected[0].id}`
      : `product-master-shopling-sales-full:${context.request.requestId}`;
  let written = 0;
  try {
    for (let index = 0; index < selected.length; index += APPLY_BATCH_SIZE) {
      const batch = selected.slice(index, index + APPLY_BATCH_SIZE);
      await pushSales(batch);
      written += batch.length;
    }
    const verifiedPlan = await currentApplyPlan(context);
    const verifiedIds = new Set(
      verifiedPlan.alreadyApplied.map((row) => row.id),
    );
    const missing = selected.filter((row) => !verifiedIds.has(row.id));
    if (verifiedPlan.blockers.length || missing.length) {
      throw new Error(
        `PRODUCT_MASTER_SALES_VERIFY_FAILED:blockers=${verifiedPlan.blockers.length}:missing=${missing.length}`,
      );
    }
    await storeOperation({
      operationType,
      sourceEventId,
      correlationId: context.cid,
      inputSnapshot: {
        requestId: context.request.requestId,
        mode,
        selectedCount: selected.length,
      },
      resultSnapshot: {
        verified: true,
        written,
        pendingCount: verifiedPlan.pending.length,
        blockerCount: verifiedPlan.blockers.length,
      },
    });
    return {
      mode,
      applied: written,
      verified: true,
      status: await loadProductMasterShoplingSalesStatus(),
      message:
        mode === "CANARY"
          ? "판매원장 1건을 저장하고 상품마스터에서 동일 수량·매출·월을 재확인했습니다."
          : `남은 판매원장 ${written}건을 멱등 저장하고 전수 재검증했습니다.`,
    };
  } catch (error) {
    const message = safeMessage(error);
    await storeOperation({
      operationType,
      sourceEventId,
      correlationId: context.cid,
      status: "FAILED",
      inputSnapshot: {
        requestId: context.request.requestId,
        mode,
        selectedCount: selected.length,
      },
      resultSnapshot: {
        verified: false,
        writtenBeforeFailure: written,
        retryIsIdempotent: true,
      },
      errorMessage: message,
    }).catch(() => undefined);
    throw error;
  }
}

export async function loadProductMasterShoplingSalesStatus(): Promise<ProductMasterShoplingSalesStatus> {
  const configured = productMasterShoplingSalesConfigured();
  const context = await activeContext();
  const empty = {
    configured,
    requestId: null,
    state: "IDLE" as const,
    stage: "대기",
    message: "아직 최근 24개월 Shopling 판매원장 수집을 시작하지 않았습니다.",
    progress: 0,
    completedRanges: 0,
    totalRanges: 0,
    fetchedRows: 0,
    acceptedRows: 0,
    unmappedRows: 0,
    monthlyRowCount: 0,
    safeRowCount: 0,
    alreadyAppliedCount: 0,
    pendingCount: 0,
    blockerCount: 0,
    canaryVerified: false,
    chunkDays: 0,
    report: null,
    blockers: [],
    error: null,
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
  const report = context.reports.map(reportFromRow).find(Boolean) ?? null;
  const common = {
    configured,
    requestId: context.request.requestId,
    progress: totalRanges
      ? Math.min(100, Math.round((completedRanges / totalRanges) * 100))
      : 0,
    completedRanges,
    totalRanges,
    fetchedRows: combined.fetchedRows,
    acceptedRows: combined.acceptedRows,
    unmappedRows: combined.unmappedRows,
    monthlyRowCount: combined.monthlyRowCount,
    chunkDays: context.request.chunkDays,
  };

  if (context.failedRuns.length) {
    const latest = context.failedRuns[0];
    const error = safeMessage(
      latest.error_message || object(latest.result_snapshot).message,
    );
    return {
      ...empty,
      ...common,
      state: "FAILED",
      stage: "수집 실패",
      message: error,
      error,
    };
  }
  if (!report) {
    return {
      ...empty,
      ...common,
      state: completedRanges ? "RUNNING" : "QUEUED",
      stage: completedRanges ? "Shopling 주문 수집 중" : "예약 Worker 대기",
      message: `${completedRanges}/${totalRanges}개 기간 구간을 읽었습니다.`,
    };
  }

  if (report.unmappedRows > 0) {
    return {
      ...empty,
      ...common,
      progress: 100,
      completedRanges: totalRanges,
      report,
      state: "BLOCKED",
      stage: "과거 주문 연결 검토 필요",
      message: `유효 주문 ${report.acceptedRows + report.unmappedRows}건 중 ${report.unmappedRows}건을 현재 상품마스터 SKU로 안전하게 연결하지 못해 적재를 차단했습니다.`,
      blockerCount: report.unmappedRows,
    };
  }

  try {
    const plan = await currentApplyPlan(context);
    const verified = canaryVerified(context);
    if (plan.blockers.length) {
      return {
        ...empty,
        ...common,
        progress: 100,
        completedRanges: totalRanges,
        report,
        state: "BLOCKED",
        stage: "기존 판매원장 중복 검토 필요",
        message: `${plan.blockers.length}건의 SKU·월 중복 또는 기존값 충돌이 있어 자동 적재를 차단했습니다.`,
        safeRowCount: plan.safeRows.length,
        alreadyAppliedCount: plan.alreadyApplied.length,
        pendingCount: plan.pending.length,
        blockerCount: plan.blockers.length,
        canaryVerified: verified,
        blockers: plan.blockers.slice(0, 100),
      };
    }
    if (!plan.pending.length) {
      return {
        ...empty,
        ...common,
        progress: 100,
        completedRanges: totalRanges,
        report,
        state: "COMPLETED",
        stage: "판매원장 적재 완료",
        message: `최근 24개월 Shopling 월 판매원장 ${plan.safeRows.length}건이 모두 상품마스터에 저장·검증되었습니다.`,
        safeRowCount: plan.safeRows.length,
        alreadyAppliedCount: plan.alreadyApplied.length,
        pendingCount: 0,
        blockerCount: 0,
        canaryVerified: verified,
      };
    }
    return {
      ...empty,
      ...common,
      progress: 100,
      completedRanges: totalRanges,
      report,
      state: verified ? "READY_FULL" : "READY_CANARY",
      stage: verified ? "전수 적재 준비" : "카나리 적재 준비",
      message: verified
        ? `카나리 검증이 끝났습니다. 남은 월 판매원장 ${plan.pending.length}건을 안전하게 적재할 수 있습니다.`
        : `월 판매원장 ${plan.pending.length}건이 재검증을 통과했습니다. 먼저 1건 카나리 적재가 필요합니다.`,
      safeRowCount: plan.safeRows.length,
      alreadyAppliedCount: plan.alreadyApplied.length,
      pendingCount: plan.pending.length,
      blockerCount: 0,
      canaryVerified: verified,
    };
  } catch (error) {
    const message = safeMessage(error);
    return {
      ...empty,
      ...common,
      progress: 100,
      completedRanges: totalRanges,
      report,
      state: "BLOCKED",
      stage: "상품마스터 재검증 실패",
      message,
      blockerCount: 1,
      error: message,
    };
  }
}

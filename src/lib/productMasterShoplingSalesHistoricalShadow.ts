import {
  PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_CHUNK,
  PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_REQUEST,
} from "@/lib/productMasterShoplingDiagnostic";
import {
  PRODUCT_MASTER_SHOPLING_SALES_CHUNK,
  PRODUCT_MASTER_SHOPLING_SALES_REQUEST,
  loadProductMasterShoplingSalesStatus,
  productMasterShoplingSalesConfigured,
} from "@/lib/productMasterShoplingSalesBackfill";
import { loadProductMasterShoplingSalesCatalogEvidence } from "@/lib/productMasterShoplingSalesCatalogEvidence";
import {
  aggregateProductMasterShoplingSalesHistoricalShadowChunk,
  buildHistoricalOptionFallbackIndex,
  combineProductMasterShoplingSalesHistoricalShadowChunks,
  type HistoricalCatalogOption,
  type ProductMasterShoplingSalesHistoricalShadowChunk,
} from "@/lib/productMasterShoplingSalesHistoricalShadowEngine";
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

export const PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_REQUEST =
  "PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_REQUEST";
export const PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_CHUNK =
  "PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_CHUNK";
export const PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_STEP_FAILURE =
  "PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_STEP_FAILURE";
export const PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_FAILED =
  "PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_FAILED";
export const PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_REPORT =
  "PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_REPORT";

const MAX_STEP_ATTEMPTS = 3;
const OPERATION_LIMIT = 500;
const MAX_CATALOG_OPTIONS = 50_000;

export type ProductMasterShoplingSalesHistoricalShadowRequest = {
  requestId: string;
  baselineRequestId: string;
  catalogRequestId: string;
  planningFingerprint: string;
  resolverFingerprint: string;
  chunkDays: number;
  ranges: ShoplingDateRange[];
  createdAt: string;
};

export type ProductMasterShoplingSalesHistoricalShadowReport = {
  generatedAt: string;
  requestId: string;
  baselineRequestId: string;
  catalogRequestId: string;
  resolverFingerprint: string;
  resolverStats: {
    catalogOptionCount: number;
    catalogOptionIdCount: number;
    safeOptionCount: number;
    ambiguousHistoricalBarcodeCount: number;
    legacyBarcodeCount: number;
    ambiguousCurrentUnitsCount: number;
    noCurrentListingCount: number;
  };
  baseline: {
    fetchedRows: number;
    acceptedRows: number;
    ignoredRows: number;
    unmappedRows: number;
    duplicateRows: number;
  };
  shadow: {
    fetchedRows: number;
    acceptedRows: number;
    ignoredRows: number;
    unmappedRows: number;
    duplicateRows: number;
    totalBaseUnits: number;
    totalRevenue: number;
    monthlyRowCount: number;
    barcodeCount: number;
    fallbackResolvedRows: number;
    fallbackBaseUnits: number;
    fallbackRevenue: number;
    fallbackRejectedDirectCodeConflict: number;
    fallbackRejectedGoodsKeyMismatch: number;
  };
  stableComparison: {
    stableRangeCount: number;
    volatileRangeCount: number;
    sourceShapeMatch: boolean;
    deltaConsistent: boolean;
    baselineAcceptedRows: number;
    shadowAcceptedRows: number;
    baselineUnmappedRows: number;
    shadowUnmappedRows: number;
    acceptedDelta: number;
    unmappedDelta: number;
    fallbackResolvedRows: number;
  };
  safeToPromote: boolean;
  promotionReason: string;
  fallbackSamples: ProductMasterShoplingSalesHistoricalShadowChunk["fallbackSamples"];
  sourceReadsPerformed: true;
  businessWritesPerformed: false;
};

export type ProductMasterShoplingSalesHistoricalShadowStatus = {
  configured: boolean;
  requestId: string | null;
  baselineRequestId: string | null;
  state: "IDLE" | "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  stage: string;
  message: string;
  completedRanges: number;
  totalRanges: number;
  progress: number;
  fallbackResolvedRows: number;
  report: ProductMasterShoplingSalesHistoricalShadowReport | null;
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

type BaselineRequest = {
  requestId: string;
  chunkDays: number;
  ranges: ShoplingDateRange[];
};

type BaselineChunkMetric = {
  range: ShoplingDateRange;
  fetchedRows: number;
  acceptedRows: number;
  ignoredRows: number;
  unmappedRows: number;
  duplicateRows: number;
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

function shadowCorrelationId(requestId: string) {
  return `product-master-shopling-sales-historical-shadow:${requestId}`;
}

function baselineCorrelationId(requestId: string) {
  return `product-master-shopling-sales:${requestId}`;
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
          source: "ops-center-product-master-shopling-sales-shadow",
          source_event_id: input.sourceEventId,
          correlation_id: input.correlationId,
          actor_type: "OPS_SHADOW_WORKER",
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
      `PRODUCT_MASTER_SHOPLING_SALES_SHADOW_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
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

function parseBaselineRequest(row: OperationRow): BaselineRequest | null {
  const input = object(row.input_snapshot);
  const requestId = text(input.requestId);
  const ranges = Array.isArray(input.ranges)
    ? input.ranges.map(parseRange).filter(Boolean) as ShoplingDateRange[]
    : [];
  if (!requestId || !ranges.length) return null;
  return {
    requestId,
    chunkDays: Math.max(1, Math.round(number(input.chunkDays)) || 1),
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

async function latestCatalogContext() {
  const planning = await loadProductPlanningSnapshot();
  const requestRows = await readOperations(
    PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_REQUEST,
    undefined,
    20,
  );
  const latest = requestRows.find((row) => {
    const input = object(row.input_snapshot);
    return Boolean(text(input.requestId) && text(row.correlation_id));
  });
  if (!latest) throw new Error("SHOPLING_CATALOG_DIAGNOSTIC_REQUEST_NOT_FOUND");
  const catalogRequestId = text(object(latest.input_snapshot).requestId);
  const correlationId = text(latest.correlation_id);
  const chunkRows = await readOperations(
    PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_CHUNK,
    correlationId,
  );
  const catalogOptions: HistoricalCatalogOption[] = [];
  for (const row of [...chunkRows].reverse()) {
    const result = object(row.result_snapshot);
    if (!Array.isArray(result.options)) continue;
    for (const raw of result.options) {
      if (catalogOptions.length >= MAX_CATALOG_OPTIONS) break;
      const option = object(raw);
      const barcode = text(option.barcode) || text(option.partnerOptionCode);
      const optionId = text(option.optionId);
      if (!barcode || !optionId) continue;
      catalogOptions.push({
        goodsKey: text(option.goodsKey),
        optionId,
        barcode,
        productName: text(option.productName),
        optionName: text(option.optionName),
        isActive: option.isActive !== false,
      });
    }
    if (catalogOptions.length >= MAX_CATALOG_OPTIONS) break;
  }
  const resolver = buildHistoricalOptionFallbackIndex(planning, catalogOptions);
  return {
    planning,
    planningFingerprint: text(planning.contentFingerprint),
    catalogRequestId,
    catalogChunkCount: chunkRows.length,
    resolver,
  };
}

function parseShadowRequest(row: OperationRow): ProductMasterShoplingSalesHistoricalShadowRequest | null {
  const input = object(row.input_snapshot);
  const requestId = text(input.requestId);
  const baselineRequestId = text(input.baselineRequestId);
  const catalogRequestId = text(input.catalogRequestId);
  const planningFingerprint = text(input.planningFingerprint);
  const resolverFingerprint = text(input.resolverFingerprint);
  const createdAt = iso(input.createdAt);
  const ranges = Array.isArray(input.ranges)
    ? input.ranges.map(parseRange).filter(Boolean) as ShoplingDateRange[]
    : [];
  if (
    !requestId ||
    !baselineRequestId ||
    !catalogRequestId ||
    !planningFingerprint ||
    !/^sha256:[a-f0-9]{64}$/.test(resolverFingerprint) ||
    !createdAt ||
    !ranges.length
  ) {
    return null;
  }
  return {
    requestId,
    baselineRequestId,
    catalogRequestId,
    planningFingerprint,
    resolverFingerprint,
    chunkDays: Math.max(1, Math.round(number(input.chunkDays)) || 1),
    ranges,
    createdAt,
  };
}

function parseShadowChunk(row: OperationRow): ProductMasterShoplingSalesHistoricalShadowChunk | null {
  const value = object(row.result_snapshot);
  const range = parseRange(value.range);
  if (!range) return null;
  const monthlyRows = Array.isArray(value.monthlyRows)
    ? value.monthlyRows.map(object).map((sales) => ({
        id: text(sales.id),
        barcode: text(sales.barcode),
        month: text(sales.month),
        quantity: integer(sales.quantity),
        revenue: integer(sales.revenue),
        lastSaleAt: iso(sales.lastSaleAt),
        source: "shopling_orders_24m_v1" as const,
      }))
    : [];
  const fallbackSamples = Array.isArray(value.fallbackSamples)
    ? value.fallbackSamples.map(object).map((sample) => ({
        orderedAt: text(sample.orderedAt),
        optionId: text(sample.optionId),
        productId: text(sample.productId) || null,
        mallProductKey: text(sample.mallProductKey) || null,
        barcode: text(sample.barcode),
        unitsPerOrder: Math.max(1, integer(sample.unitsPerOrder) || 1),
        orderQuantity: integer(sample.orderQuantity),
        baseUnits: integer(sample.baseUnits),
        status: text(sample.status),
      }))
    : [];
  return {
    range,
    fetchedRows: integer(value.fetchedRows),
    acceptedRows: integer(value.acceptedRows),
    ignoredRows: integer(value.ignoredRows),
    unmappedRows: integer(value.unmappedRows),
    duplicateRows: integer(value.duplicateRows),
    totalBaseUnits: integer(value.totalBaseUnits),
    totalRevenue: integer(value.totalRevenue),
    monthlyRows,
    fallbackResolvedRows: integer(value.fallbackResolvedRows),
    fallbackBaseUnits: integer(value.fallbackBaseUnits),
    fallbackRevenue: integer(value.fallbackRevenue),
    fallbackRejectedDirectCodeConflict: integer(
      value.fallbackRejectedDirectCodeConflict,
    ),
    fallbackRejectedGoodsKeyMismatch: integer(
      value.fallbackRejectedGoodsKeyMismatch,
    ),
    fallbackSamples,
  };
}

function parseBaselineChunk(row: OperationRow): BaselineChunkMetric | null {
  const value = object(row.result_snapshot);
  const range = parseRange(value.range);
  if (!range) return null;
  return {
    range,
    fetchedRows: integer(value.fetchedRows),
    acceptedRows: integer(value.acceptedRows),
    ignoredRows: integer(value.ignoredRows),
    unmappedRows: integer(value.unmappedRows),
    duplicateRows: integer(value.duplicateRows),
  };
}

function parseReport(row: OperationRow) {
  const value = object(row.result_snapshot);
  const report = value.report;
  return report && typeof report === "object" && !Array.isArray(report)
    ? (report as ProductMasterShoplingSalesHistoricalShadowReport)
    : null;
}

async function latestShadowRequest() {
  const rows = await readOperations(
    PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_REQUEST,
    undefined,
    20,
  );
  for (const row of rows) {
    const parsed = parseShadowRequest(row);
    if (parsed) return parsed;
  }
  return null;
}

async function shadowContext() {
  const request = await latestShadowRequest();
  if (!request) return null;
  const cid = shadowCorrelationId(request.requestId);
  const [chunks, failures, failedRuns, reports] = await Promise.all([
    readOperations(PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_CHUNK, cid),
    readOperations(
      PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_STEP_FAILURE,
      cid,
    ),
    readOperations(PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_FAILED, cid, 5),
    readOperations(PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_REPORT, cid, 5),
  ]);
  return { request, cid, chunks, failures, failedRuns, reports };
}

function failureAttempt(row: OperationRow) {
  const input = object(row.input_snapshot);
  return {
    rangeKey: text(input.rangeKey),
    attempt: integer(input.attempt),
    message: safeMessage(row.error_message || object(row.result_snapshot).message),
  };
}

export function productMasterShoplingSalesHistoricalShadowConfigured() {
  if (!productMasterShoplingSalesConfigured()) return false;
  try {
    shoplingReadConfigFromEnv(shoplingEnvironment());
    supabaseConnection();
    return true;
  } catch {
    return false;
  }
}

export async function createProductMasterShoplingSalesHistoricalShadowRequest() {
  if (!productMasterShoplingSalesHistoricalShadowConfigured()) {
    throw new Error("PRODUCT_MASTER_SHOPLING_SALES_SHADOW_NOT_CONFIGURED");
  }
  const baselineStatus = await loadProductMasterShoplingSalesStatus();
  if (
    baselineStatus.state !== "BLOCKED" ||
    !baselineStatus.requestId ||
    !baselineStatus.report ||
    baselineStatus.unmappedRows < 1
  ) {
    throw new Error("PRODUCT_MASTER_SHOPLING_SALES_SHADOW_BASELINE_NOT_BLOCKED");
  }
  const [baselineRequest, evidence, catalog] = await Promise.all([
    latestBaselineRequest(),
    loadProductMasterShoplingSalesCatalogEvidence(),
    latestCatalogContext(),
  ]);
  if (!baselineRequest || baselineRequest.requestId !== baselineStatus.requestId) {
    throw new Error("PRODUCT_MASTER_SHOPLING_SALES_SHADOW_BASELINE_REQUEST_MISMATCH");
  }
  if (evidence.highConfidenceAutoResolveSamples < 1) {
    throw new Error("PRODUCT_MASTER_SHOPLING_SALES_SHADOW_NO_EVIDENCE");
  }
  if (catalog.resolver.stats.safeOptionCount < 1) {
    throw new Error("PRODUCT_MASTER_SHOPLING_SALES_SHADOW_NO_SAFE_RESOLVER");
  }

  const request: ProductMasterShoplingSalesHistoricalShadowRequest = {
    requestId: crypto.randomUUID(),
    baselineRequestId: baselineRequest.requestId,
    catalogRequestId: catalog.catalogRequestId,
    planningFingerprint: catalog.planningFingerprint,
    resolverFingerprint: catalog.resolver.fingerprint,
    chunkDays: baselineRequest.chunkDays,
    ranges: baselineRequest.ranges,
    createdAt: new Date().toISOString(),
  };
  await storeOperation({
    operationType: PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_REQUEST,
    sourceEventId: `product-master-shopling-sales-historical-shadow-request:${request.requestId}`,
    correlationId: shadowCorrelationId(request.requestId),
    inputSnapshot: request,
    resultSnapshot: {
      accepted: true,
      state: "QUEUED",
      baselineUnmappedRows: baselineStatus.unmappedRows,
      catalogChunkCount: catalog.catalogChunkCount,
      resolverStats: catalog.resolver.stats,
      message:
        "과거 optionId 고신뢰 resolver를 실제 원장에 반영하지 않고 동일 주문범위를 그림자 재계산합니다.",
    },
    occurredAt: request.createdAt,
  });
  return request;
}

async function validateResolverSnapshot(
  request: ProductMasterShoplingSalesHistoricalShadowRequest,
) {
  const [baselineStatus, catalog] = await Promise.all([
    loadProductMasterShoplingSalesStatus(),
    latestCatalogContext(),
  ]);
  if (baselineStatus.requestId !== request.baselineRequestId) {
    throw new Error("PRODUCT_MASTER_SHOPLING_SALES_SHADOW_BASELINE_CHANGED");
  }
  if (catalog.catalogRequestId !== request.catalogRequestId) {
    throw new Error("PRODUCT_MASTER_SHOPLING_SALES_SHADOW_CATALOG_CHANGED");
  }
  if (catalog.planningFingerprint !== request.planningFingerprint) {
    throw new Error("PRODUCT_MASTER_SHOPLING_SALES_SHADOW_PLANNING_CHANGED");
  }
  if (catalog.resolver.fingerprint !== request.resolverFingerprint) {
    throw new Error("PRODUCT_MASTER_SHOPLING_SALES_SHADOW_RESOLVER_CHANGED");
  }
  return { baselineStatus, catalog };
}

async function finalizeShadow(
  context: NonNullable<Awaited<ReturnType<typeof shadowContext>>>,
  chunks: ProductMasterShoplingSalesHistoricalShadowChunk[],
) {
  const { baselineStatus, catalog } = await validateResolverSnapshot(
    context.request,
  );
  if (!baselineStatus.report) {
    throw new Error("PRODUCT_MASTER_SHOPLING_SALES_SHADOW_BASELINE_REPORT_MISSING");
  }
  const baselineChunkRows = await readOperations(
    PRODUCT_MASTER_SHOPLING_SALES_CHUNK,
    baselineCorrelationId(context.request.baselineRequestId),
  );
  const baselineChunks = baselineChunkRows
    .map(parseBaselineChunk)
    .filter(Boolean) as BaselineChunkMetric[];
  const baselineByRange = new Map(
    baselineChunks.map((chunk) => [rangeKey(chunk.range), chunk]),
  );
  const volatileEnd = context.request.ranges.at(-1)?.end ?? "";
  const stableComparisons = chunks
    .filter((chunk) => chunk.range.end < volatileEnd)
    .map((shadow) => ({
      shadow,
      baseline: baselineByRange.get(rangeKey(shadow.range)) ?? null,
    }));
  const volatileRangeCount = chunks.length - stableComparisons.length;
  const sourceShapeMatch =
    stableComparisons.length > 0 &&
    stableComparisons.every(
      ({ shadow, baseline }) =>
        Boolean(baseline) &&
        shadow.fetchedRows === baseline!.fetchedRows &&
        shadow.ignoredRows === baseline!.ignoredRows &&
        shadow.duplicateRows === baseline!.duplicateRows,
    );
  const stableTotals = stableComparisons.reduce(
    (totals, { shadow, baseline }) => {
      totals.baselineAcceptedRows += baseline?.acceptedRows ?? 0;
      totals.shadowAcceptedRows += shadow.acceptedRows;
      totals.baselineUnmappedRows += baseline?.unmappedRows ?? 0;
      totals.shadowUnmappedRows += shadow.unmappedRows;
      totals.fallbackResolvedRows += shadow.fallbackResolvedRows;
      return totals;
    },
    {
      baselineAcceptedRows: 0,
      shadowAcceptedRows: 0,
      baselineUnmappedRows: 0,
      shadowUnmappedRows: 0,
      fallbackResolvedRows: 0,
    },
  );
  const acceptedDelta =
    stableTotals.shadowAcceptedRows - stableTotals.baselineAcceptedRows;
  const unmappedDelta =
    stableTotals.baselineUnmappedRows - stableTotals.shadowUnmappedRows;
  const deltaConsistent =
    acceptedDelta >= 0 &&
    unmappedDelta >= 0 &&
    acceptedDelta === unmappedDelta &&
    acceptedDelta === stableTotals.fallbackResolvedRows;
  const combined = combineProductMasterShoplingSalesHistoricalShadowChunks(chunks);
  const safeToPromote =
    sourceShapeMatch &&
    deltaConsistent &&
    stableTotals.fallbackResolvedRows > 0;
  const promotionReason = safeToPromote
    ? `종료일이 포함된 변동 가능 구간 ${volatileRangeCount}개를 제외한 ${stableComparisons.length}개 구간에서 기존 accepted 증가량, unmapped 감소량, historical fallback 해결량이 모두 ${stableTotals.fallbackResolvedRows}건으로 일치했습니다.`
    : !stableComparisons.length
      ? "비교 가능한 종료일 이전 안정 구간이 없어 promotion을 허용하지 않습니다."
      : !sourceShapeMatch
        ? "동일 안정 구간의 Shopling 조회행·제외행·중복행이 기존 원장과 달라 source drift 가능성이 있어 promotion을 허용하지 않습니다."
        : !deltaConsistent
          ? "accepted 증가량·unmapped 감소량·fallback 해결량이 서로 일치하지 않아 promotion을 허용하지 않습니다."
          : "안정 구간에서 실제로 추가 해결된 주문이 없어 promotion 이점이 확인되지 않았습니다.";

  const report: ProductMasterShoplingSalesHistoricalShadowReport = {
    generatedAt: new Date().toISOString(),
    requestId: context.request.requestId,
    baselineRequestId: context.request.baselineRequestId,
    catalogRequestId: context.request.catalogRequestId,
    resolverFingerprint: context.request.resolverFingerprint,
    resolverStats: catalog.resolver.stats,
    baseline: {
      fetchedRows: baselineStatus.report.fetchedRows,
      acceptedRows: baselineStatus.report.acceptedRows,
      ignoredRows: baselineStatus.report.ignoredRows,
      unmappedRows: baselineStatus.report.unmappedRows,
      duplicateRows: baselineStatus.report.duplicateRows,
    },
    shadow: {
      fetchedRows: combined.fetchedRows,
      acceptedRows: combined.acceptedRows,
      ignoredRows: combined.ignoredRows,
      unmappedRows: combined.unmappedRows,
      duplicateRows: combined.duplicateRows,
      totalBaseUnits: combined.totalBaseUnits,
      totalRevenue: combined.totalRevenue,
      monthlyRowCount: combined.monthlyRowCount,
      barcodeCount: combined.barcodeCount,
      fallbackResolvedRows: combined.fallbackResolvedRows,
      fallbackBaseUnits: combined.fallbackBaseUnits,
      fallbackRevenue: combined.fallbackRevenue,
      fallbackRejectedDirectCodeConflict:
        combined.fallbackRejectedDirectCodeConflict,
      fallbackRejectedGoodsKeyMismatch:
        combined.fallbackRejectedGoodsKeyMismatch,
    },
    stableComparison: {
      stableRangeCount: stableComparisons.length,
      volatileRangeCount,
      sourceShapeMatch,
      deltaConsistent,
      baselineAcceptedRows: stableTotals.baselineAcceptedRows,
      shadowAcceptedRows: stableTotals.shadowAcceptedRows,
      baselineUnmappedRows: stableTotals.baselineUnmappedRows,
      shadowUnmappedRows: stableTotals.shadowUnmappedRows,
      acceptedDelta,
      unmappedDelta,
      fallbackResolvedRows: stableTotals.fallbackResolvedRows,
    },
    safeToPromote,
    promotionReason,
    fallbackSamples: combined.fallbackSamples,
    sourceReadsPerformed: true,
    businessWritesPerformed: false,
  };
  await storeOperation({
    operationType: PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_REPORT,
    sourceEventId: `product-master-shopling-sales-historical-shadow-report:${context.request.requestId}`,
    correlationId: context.cid,
    inputSnapshot: {
      requestId: context.request.requestId,
      baselineRequestId: context.request.baselineRequestId,
      rangeCount: context.request.ranges.length,
    },
    resultSnapshot: { report },
  });
  return report;
}

export async function runProductMasterShoplingSalesHistoricalShadowStep() {
  const context = await shadowContext();
  if (!context) {
    return {
      processed: false,
      state: "IDLE" as const,
      message: "historical option shadow 작업이 없습니다.",
    };
  }
  const completedReport = context.reports.map(parseReport).find(Boolean);
  if (completedReport) {
    return {
      processed: false,
      state: "COMPLETED" as const,
      message: completedReport.promotionReason,
      report: completedReport,
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
    .map(parseShadowChunk)
    .filter(Boolean) as ProductMasterShoplingSalesHistoricalShadowChunk[];
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
      const message = `${key} historical shadow 주문 조회가 ${MAX_STEP_ATTEMPTS}회 실패했습니다. 최종 원인: ${attempts[0]?.message || "확인 필요"}`;
      await storeOperation({
        operationType: PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_FAILED,
        sourceEventId: `product-master-shopling-sales-historical-shadow-failed:${context.request.requestId}`,
        correlationId: context.cid,
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
      const { catalog } = await validateResolverSnapshot(context.request);
      const config = shoplingReadConfigFromEnv(shoplingEnvironment());
      const rows = await new ShoplingReadClient(config).read("orders", nextRange);
      const result = aggregateProductMasterShoplingSalesHistoricalShadowChunk(
        rows,
        catalog.planning,
        nextRange,
        catalog.resolver,
      );
      await storeOperation({
        operationType: PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_CHUNK,
        sourceEventId: `product-master-shopling-sales-historical-shadow-chunk:${context.request.requestId}:${key}`,
        correlationId: context.cid,
        inputSnapshot: {
          requestId: context.request.requestId,
          range: nextRange,
          rangeKey: key,
          resolverFingerprint: context.request.resolverFingerprint,
        },
        resultSnapshot: result,
      });
      return {
        processed: true,
        state: "RUNNING" as const,
        range: nextRange,
        fetchedRows: result.fetchedRows,
        acceptedRows: result.acceptedRows,
        unmappedRows: result.unmappedRows,
        fallbackResolvedRows: result.fallbackResolvedRows,
        message: `${key} 주문을 historical option shadow resolver로 재계산했습니다. 실제 판매원장 쓰기는 없습니다.`,
      };
    } catch (error) {
      const attempt = attempts.length + 1;
      const message = safeMessage(error);
      await storeOperation({
        operationType:
          PRODUCT_MASTER_SHOPLING_SALES_HISTORICAL_SHADOW_STEP_FAILURE,
        sourceEventId: `product-master-shopling-sales-historical-shadow-step-failure:${context.request.requestId}:${key}:${attempt}`,
        correlationId: context.cid,
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

  const report = await finalizeShadow(context, chunks);
  return {
    processed: true,
    state: "COMPLETED" as const,
    report,
    message: report.promotionReason,
  };
}

export async function loadProductMasterShoplingSalesHistoricalShadowStatus(): Promise<ProductMasterShoplingSalesHistoricalShadowStatus> {
  const configured = productMasterShoplingSalesHistoricalShadowConfigured();
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
      fallbackResolvedRows: 0,
      report: null,
      error: null,
    };
  }

  try {
    const context = await shadowContext();
    if (!context) {
      return {
        configured: true,
        requestId: null,
        baselineRequestId: null,
        state: "IDLE",
        stage: "대기",
        message:
          "기존 판매원장이 BLOCKED이고 고신뢰 과거 option 증거가 있으면 Worker가 자동으로 shadow 재계산을 시작합니다.",
        completedRanges: 0,
        totalRanges: 0,
        progress: 0,
        fallbackResolvedRows: 0,
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
        stage: report.safeToPromote ? "promotion gate 통과" : "검증 차단",
        message: report.promotionReason,
        completedRanges: context.request.ranges.length,
        totalRanges: context.request.ranges.length,
        progress: 100,
        fallbackResolvedRows: report.shadow.fallbackResolvedRows,
        report,
        error: null,
      };
    }
    if (context.failedRuns.length) {
      const error = safeMessage(
        context.failedRuns[0]?.error_message ||
          object(context.failedRuns[0]?.result_snapshot).message,
      );
      return {
        configured: true,
        requestId: context.request.requestId,
        baselineRequestId: context.request.baselineRequestId,
        state: "FAILED",
        stage: "그림자 재계산 실패",
        message: error,
        completedRanges: context.chunks.map(parseShadowChunk).filter(Boolean).length,
        totalRanges: context.request.ranges.length,
        progress: 0,
        fallbackResolvedRows: 0,
        report: null,
        error,
      };
    }
    const chunks = context.chunks
      .map(parseShadowChunk)
      .filter(Boolean) as ProductMasterShoplingSalesHistoricalShadowChunk[];
    const completedRanges = chunks.length;
    const totalRanges = context.request.ranges.length;
    return {
      configured: true,
      requestId: context.request.requestId,
      baselineRequestId: context.request.baselineRequestId,
      state: completedRanges ? "RUNNING" : "QUEUED",
      stage: completedRanges ? "과거 option 그림자 재계산" : "작업 대기열",
      message: `동일한 ${totalRanges}개 주문 구간을 읽기 전용으로 재계산 중입니다. Product Master 판매원장 쓰기는 0회입니다.`,
      completedRanges,
      totalRanges,
      progress: totalRanges
        ? Math.round((completedRanges / totalRanges) * 10_000) / 100
        : 0,
      fallbackResolvedRows: chunks.reduce(
        (sum, chunk) => sum + chunk.fallbackResolvedRows,
        0,
      ),
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
      fallbackResolvedRows: 0,
      report: null,
      error: message,
    };
  }
}

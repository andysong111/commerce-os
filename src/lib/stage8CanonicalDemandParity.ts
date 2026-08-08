import { createHash } from "node:crypto";
import {
  loadProductMasterCanonicalSalesAudit,
  type CanonicalRollingSalesRow,
  type ProductMasterCanonicalSalesSnapshot,
} from "@/lib/productMasterCanonicalSalesAudit";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import {
  aggregateShoplingOrderChunk,
  combineShoplingLiveChunks,
  type ProductPlanningSnapshot,
  type ShoplingOrderChunkSummary,
} from "@/lib/shopling/shoplingLiveAggregation";
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

export const CANONICAL_DEMAND_PARITY_REQUEST =
  "STAGE8_CANONICAL_DEMAND_PARITY_REQUEST";
export const CANONICAL_DEMAND_PARITY_ORDER_CHUNK =
  "STAGE8_CANONICAL_DEMAND_PARITY_ORDER_CHUNK";
export const CANONICAL_DEMAND_PARITY_STEP_FAILURE =
  "STAGE8_CANONICAL_DEMAND_PARITY_STEP_FAILURE";
export const CANONICAL_DEMAND_PARITY_FAILED =
  "STAGE8_CANONICAL_DEMAND_PARITY_FAILED";
export const CANONICAL_DEMAND_PARITY_REPORT =
  "STAGE8_CANONICAL_DEMAND_PARITY_REPORT";

const ANALYSIS_DAYS = 360;
const RANGE_DAYS = 7;
const BUCKET_COUNT = 12;
const MAX_STEP_ATTEMPTS = 3;
const OPERATION_LIMIT = 500;
const MANAGED_BARCODE = /^B[A-Z]{2}\d+-\d+$/;
const MAX_MISMATCH_SAMPLES = 50;

type OperationRow = {
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

export type CanonicalDemandParityRequest = {
  requestId: string;
  analysisAsOf: string;
  analysisStartDate: string;
  analysisEndDate: string;
  planningGeneratedAt: string;
  planningContentFingerprint: string;
  canonicalContentFingerprint: string;
  ranges: ShoplingDateRange[];
  createdAt: string;
};

export type CanonicalDemandParityMismatch = {
  barcode: string;
  unitBuckets: number[];
  revenueBuckets: number[];
  canonicalUnits: number[];
  directUnits: number[];
  canonicalRevenue: number[];
  directRevenue: number[];
};

export type CanonicalDemandParityReport = {
  generatedAt: string;
  analysisAsOf: string;
  planningContentFingerprint: string;
  canonicalContentFingerprint: string;
  canonicalRowCount: number;
  directManagedRowCount: number;
  sharedRowCount: number;
  exactRowCount: number;
  unitMismatchCount: number;
  revenueMismatchCount: number;
  missingDirectCount: number;
  directOnlyManagedCount: number;
  directFetchedRows: number;
  directAcceptedRows: number;
  directUnmappedRows: number;
  canonicalManagedUnits: number;
  directManagedUnits: number;
  canonicalManagedRevenue: number;
  directManagedRevenue: number;
  directPortfolioRecent30Revenue: number;
  mismatchSamples: CanonicalDemandParityMismatch[];
  missingDirectBarcodes: string[];
  directOnlyManagedBarcodes: string[];
  blockerCount: number;
  parityFingerprint: string;
};

export type CanonicalDemandParityStatus = {
  configured: boolean;
  requestId: string | null;
  state: "IDLE" | "QUEUED" | "RUNNING" | "MATCH" | "MISMATCH" | "FAILED";
  stage: string;
  message: string;
  completedRanges: number;
  totalRanges: number;
  progress: number;
  report: CanonicalDemandParityReport | null;
  blockerCount: number;
  error: string | null;
};

type FailureSnapshot = {
  stageKey?: unknown;
  attempt?: unknown;
  message?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").trim();
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

function safeMessage(error: unknown) {
  const message = error instanceof Error ? error.message : text(error);
  return message
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, "[redacted]")
    .slice(0, 1000);
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function rangeKey(range: ShoplingDateRange) {
  return `${range.start}:${range.end}`;
}

function requestCorrelationId(requestId: string) {
  return `stage8-canonical-demand-parity:${requestId}`;
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

export function canonicalDemandParityConfigured() {
  try {
    shoplingReadConfigFromEnv(shoplingEnvironment());
    supabaseConnection();
    return Boolean(process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim());
  } catch {
    return false;
  }
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
          source: "stage8-canonical-demand-parity",
          source_event_id: input.sourceEventId,
          correlation_id: input.correlationId,
          actor_type:
            input.operationType === CANONICAL_DEMAND_PARITY_REQUEST
              ? "OPS_OPERATOR"
              : "OPS_WORKER",
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
      `CANONICAL_DEMAND_PARITY_STORE_FAILED:${response.status}:${body.slice(0, 400)}`,
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
      "source_event_id,correlation_id,status,input_snapshot,result_snapshot,error_message,started_at",
    )
    .eq("operation_type", operationType);
  if (correlationId) query = query.eq("correlation_id", correlationId);
  const result = await query.order("started_at", { ascending: false }).limit(limit);
  if (result.error) throw new Error(result.error.message);
  return (Array.isArray(result.data) ? result.data : []).filter(
    (row): row is OperationRow => Boolean(row && typeof row === "object"),
  );
}

function parseRanges(value: unknown): ShoplingDateRange[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(object)
    .map((range) => ({ start: text(range.start), end: text(range.end) }))
    .filter(
      (range) =>
        /^\d{4}-\d{2}-\d{2}$/.test(range.start) &&
        /^\d{4}-\d{2}-\d{2}$/.test(range.end),
    );
}

function requestFromRow(row: OperationRow): CanonicalDemandParityRequest | null {
  const value = object(row.input_snapshot);
  const requestId = text(value.requestId);
  const analysisAsOf = iso(value.analysisAsOf);
  const planningGeneratedAt = iso(value.planningGeneratedAt);
  const planningContentFingerprint = text(value.planningContentFingerprint);
  const canonicalContentFingerprint = text(value.canonicalContentFingerprint);
  const ranges = parseRanges(value.ranges);
  if (
    !requestId ||
    !analysisAsOf ||
    !planningGeneratedAt ||
    !/^sha256:[a-f0-9]{64}$/.test(planningContentFingerprint) ||
    !/^sha256:[a-f0-9]{64}$/.test(canonicalContentFingerprint) ||
    !ranges.length
  ) {
    return null;
  }
  return {
    requestId,
    analysisAsOf,
    analysisStartDate: text(value.analysisStartDate),
    analysisEndDate: text(value.analysisEndDate),
    planningGeneratedAt,
    planningContentFingerprint,
    canonicalContentFingerprint,
    ranges,
    createdAt: iso(value.createdAt) || analysisAsOf,
  };
}

function orderChunkFromRow(row: OperationRow): ShoplingOrderChunkSummary | null {
  const value = object(row.result_snapshot);
  return value.range && Array.isArray(value.products)
    ? (value as unknown as ShoplingOrderChunkSummary)
    : null;
}

function reportFromRow(row: OperationRow): CanonicalDemandParityReport | null {
  const value = object(row.result_snapshot);
  return /^sha256:[a-f0-9]{64}$/.test(text(value.parityFingerprint))
    ? (value as unknown as CanonicalDemandParityReport)
    : null;
}

async function latestRequest() {
  const rows = await readOperations(CANONICAL_DEMAND_PARITY_REQUEST, undefined, 20);
  for (const row of rows) {
    const request = requestFromRow(row);
    if (request) return request;
  }
  return null;
}

async function requestOperations(request: CanonicalDemandParityRequest) {
  const correlationId = requestCorrelationId(request.requestId);
  const [orders, stepFailures, terminals, reports] = await Promise.all([
    readOperations(CANONICAL_DEMAND_PARITY_ORDER_CHUNK, correlationId),
    readOperations(CANONICAL_DEMAND_PARITY_STEP_FAILURE, correlationId),
    readOperations(CANONICAL_DEMAND_PARITY_FAILED, correlationId, 10),
    readOperations(CANONICAL_DEMAND_PARITY_REPORT, correlationId, 10),
  ]);
  return { correlationId, orders, stepFailures, terminals, reports };
}

function operationRangeKey(row: OperationRow) {
  const input = object(row.input_snapshot);
  const range = object(input.range);
  return range.start && range.end
    ? `${text(range.start)}:${text(range.end)}`
    : text(input.rangeKey);
}

function stageFailureCount(rows: OperationRow[], stageKey: string) {
  return rows.filter((row) => {
    const value = object(row.result_snapshot) as FailureSnapshot;
    return text(value.stageKey) === stageKey;
  }).length;
}

async function storeStepFailure(
  request: CanonicalDemandParityRequest,
  stageKey: string,
  attempt: number,
  error: unknown,
) {
  const message = safeMessage(error);
  await storeOperation({
    operationType: CANONICAL_DEMAND_PARITY_STEP_FAILURE,
    sourceEventId: `canonical-demand-parity-step-failure:${request.requestId}:${encodeURIComponent(stageKey)}:${attempt}`,
    correlationId: requestCorrelationId(request.requestId),
    status: "FAILED",
    inputSnapshot: { requestId: request.requestId, stageKey, attempt },
    resultSnapshot: { requestId: request.requestId, stageKey, attempt, message },
    errorMessage: message,
  });
  return message;
}

async function storeTerminalFailure(
  request: CanonicalDemandParityRequest,
  stageKey: string,
  message: string,
) {
  await storeOperation({
    operationType: CANONICAL_DEMAND_PARITY_FAILED,
    sourceEventId: `canonical-demand-parity-failed:${request.requestId}`,
    correlationId: requestCorrelationId(request.requestId),
    status: "FAILED",
    inputSnapshot: { requestId: request.requestId, stageKey },
    resultSnapshot: { requestId: request.requestId, stageKey, message },
    errorMessage: message,
  });
}

async function verifiedContext(request: CanonicalDemandParityRequest) {
  const [planning, audit] = await Promise.all([
    loadProductPlanningSnapshot(),
    loadProductMasterCanonicalSalesAudit(),
  ]);
  if (planning.contentFingerprint !== request.planningContentFingerprint) {
    throw new Error("CANONICAL_DEMAND_PARITY_PLANNING_CHANGED");
  }
  if (!audit.ready || !audit.snapshot) {
    throw new Error(`CANONICAL_DEMAND_PARITY_AUDIT_NOT_READY:${audit.state}`);
  }
  if (audit.analysisAsOf !== request.analysisAsOf) {
    throw new Error("CANONICAL_DEMAND_PARITY_ANALYSIS_TIME_CHANGED");
  }
  if (audit.snapshot.contentFingerprint !== request.canonicalContentFingerprint) {
    throw new Error("CANONICAL_DEMAND_PARITY_CANONICAL_CHANGED");
  }
  return { planning, canonical: audit.snapshot };
}

function arraysEqual(left: number[], right: number[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => integer(value) === integer(right[index]));
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + integer(value), 0);
}

function differingBuckets(left: number[], right: number[]) {
  const output: number[] = [];
  for (let index = 0; index < BUCKET_COUNT; index += 1) {
    if (integer(left[index]) !== integer(right[index])) output.push(index);
  }
  return output;
}

function parityFingerprint(report: Omit<CanonicalDemandParityReport, "parityFingerprint">) {
  const normalized = {
    analysisAsOf: report.analysisAsOf,
    planningContentFingerprint: report.planningContentFingerprint,
    canonicalContentFingerprint: report.canonicalContentFingerprint,
    canonicalRowCount: report.canonicalRowCount,
    directManagedRowCount: report.directManagedRowCount,
    sharedRowCount: report.sharedRowCount,
    exactRowCount: report.exactRowCount,
    unitMismatchCount: report.unitMismatchCount,
    revenueMismatchCount: report.revenueMismatchCount,
    missingDirectCount: report.missingDirectCount,
    directOnlyManagedCount: report.directOnlyManagedCount,
    canonicalManagedUnits: report.canonicalManagedUnits,
    directManagedUnits: report.directManagedUnits,
    canonicalManagedRevenue: report.canonicalManagedRevenue,
    directManagedRevenue: report.directManagedRevenue,
    mismatchSamples: report.mismatchSamples,
    missingDirectBarcodes: report.missingDirectBarcodes,
    directOnlyManagedBarcodes: report.directOnlyManagedBarcodes,
  };
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex")}`;
}

export function compareCanonicalDemandWithDirectShopling(
  request: CanonicalDemandParityRequest,
  planning: ProductPlanningSnapshot,
  canonical: ProductMasterCanonicalSalesSnapshot,
  orderChunks: ShoplingOrderChunkSummary[],
): CanonicalDemandParityReport {
  const direct = combineShoplingLiveChunks(
    planning,
    orderChunks,
    [],
    request.analysisAsOf,
  );
  const directManaged = direct.products.filter((row) =>
    MANAGED_BARCODE.test(text(row.planning.barcode)),
  );
  const directByBarcode = new Map(
    directManaged.map((row) => [text(row.planning.barcode), row]),
  );
  const canonicalByBarcode = new Map(
    canonical.rows.map((row) => [text(row.barcode), row]),
  );

  let sharedRowCount = 0;
  let exactRowCount = 0;
  let unitMismatchCount = 0;
  let revenueMismatchCount = 0;
  const missingDirectBarcodes: string[] = [];
  const mismatchSamples: CanonicalDemandParityMismatch[] = [];

  for (const canonicalRow of canonical.rows) {
    const barcode = text(canonicalRow.barcode);
    const directRow = directByBarcode.get(barcode);
    if (!directRow) {
      missingDirectBarcodes.push(barcode);
      continue;
    }
    sharedRowCount += 1;
    const unitMatch = arraysEqual(canonicalRow.monthlyUnits, directRow.units);
    const revenueMatch = arraysEqual(canonicalRow.monthlyRevenue, directRow.revenue);
    if (!unitMatch) unitMismatchCount += 1;
    if (!revenueMatch) revenueMismatchCount += 1;
    if (unitMatch && revenueMatch) {
      exactRowCount += 1;
      continue;
    }
    if (mismatchSamples.length < MAX_MISMATCH_SAMPLES) {
      mismatchSamples.push({
        barcode,
        unitBuckets: differingBuckets(canonicalRow.monthlyUnits, directRow.units),
        revenueBuckets: differingBuckets(
          canonicalRow.monthlyRevenue,
          directRow.revenue,
        ),
        canonicalUnits: canonicalRow.monthlyUnits.map(integer),
        directUnits: directRow.units.map(integer),
        canonicalRevenue: canonicalRow.monthlyRevenue.map(integer),
        directRevenue: directRow.revenue.map(integer),
      });
    }
  }

  const directOnlyManagedBarcodes = [...directByBarcode.keys()]
    .filter((barcode) => !canonicalByBarcode.has(barcode))
    .sort();
  const canonicalManagedUnits = canonical.rows.reduce(
    (total, row) => total + sum(row.monthlyUnits),
    0,
  );
  const canonicalManagedRevenue = canonical.rows.reduce(
    (total, row) => total + sum(row.monthlyRevenue),
    0,
  );
  const directManagedUnits = directManaged.reduce(
    (total, row) => total + sum(row.units),
    0,
  );
  const directManagedRevenue = directManaged.reduce(
    (total, row) => total + sum(row.revenue),
    0,
  );
  const directFetchedRows = orderChunks.reduce(
    (total, chunk) => total + integer(chunk.fetchedRows),
    0,
  );
  const directAcceptedRows = orderChunks.reduce(
    (total, chunk) => total + integer(chunk.acceptedRows),
    0,
  );
  const directUnmappedRows = orderChunks.reduce(
    (total, chunk) => total + integer(chunk.unmappedRows),
    0,
  );
  const blockerCount =
    unitMismatchCount +
    revenueMismatchCount +
    missingDirectBarcodes.length +
    directOnlyManagedBarcodes.length;

  const base: Omit<CanonicalDemandParityReport, "parityFingerprint"> = {
    generatedAt: new Date().toISOString(),
    analysisAsOf: request.analysisAsOf,
    planningContentFingerprint: request.planningContentFingerprint,
    canonicalContentFingerprint: request.canonicalContentFingerprint,
    canonicalRowCount: canonical.rows.length,
    directManagedRowCount: directManaged.length,
    sharedRowCount,
    exactRowCount,
    unitMismatchCount,
    revenueMismatchCount,
    missingDirectCount: missingDirectBarcodes.length,
    directOnlyManagedCount: directOnlyManagedBarcodes.length,
    directFetchedRows,
    directAcceptedRows,
    directUnmappedRows,
    canonicalManagedUnits,
    directManagedUnits,
    canonicalManagedRevenue,
    directManagedRevenue,
    directPortfolioRecent30Revenue: integer(direct.recent30Revenue),
    mismatchSamples,
    missingDirectBarcodes,
    directOnlyManagedBarcodes,
    blockerCount,
  };
  return { ...base, parityFingerprint: parityFingerprint(base) };
}

export async function createCanonicalDemandParityRequest() {
  shoplingReadConfigFromEnv(shoplingEnvironment());
  const [planning, audit] = await Promise.all([
    loadProductPlanningSnapshot(),
    loadProductMasterCanonicalSalesAudit(),
  ]);
  if (!audit.ready || !audit.snapshot || !audit.analysisAsOf) {
    throw new Error(`CANONICAL_DEMAND_PARITY_AUDIT_NOT_READY:${audit.state}`);
  }
  const asOf = new Date(audit.analysisAsOf);
  const start = new Date(asOf.valueOf() - ANALYSIS_DAYS * 24 * 60 * 60 * 1000);
  const analysisStartDate = dateOnly(start);
  const analysisEndDate = dateOnly(asOf);
  const request: CanonicalDemandParityRequest = {
    requestId: crypto.randomUUID(),
    analysisAsOf: asOf.toISOString(),
    analysisStartDate,
    analysisEndDate,
    planningGeneratedAt: planning.generatedAt,
    planningContentFingerprint: planning.contentFingerprint,
    canonicalContentFingerprint: audit.snapshot.contentFingerprint,
    ranges: splitShoplingDateRange(analysisStartDate, analysisEndDate, RANGE_DAYS),
    createdAt: new Date().toISOString(),
  };
  await storeOperation({
    operationType: CANONICAL_DEMAND_PARITY_REQUEST,
    sourceEventId: `canonical-demand-parity-request:${request.requestId}`,
    correlationId: requestCorrelationId(request.requestId),
    inputSnapshot: request,
    resultSnapshot: {
      accepted: true,
      state: "QUEUED",
      message:
        "Canonical 12×30일 수요와 같은 분석시점의 Shopling 직접 집계를 읽기 전용으로 비교합니다.",
    },
    occurredAt: request.createdAt,
  });
  return request;
}

export async function runCanonicalDemandParityStep() {
  const request = await latestRequest();
  if (!request) return { processed: false, state: "IDLE" as const };
  const operations = await requestOperations(request);
  if (operations.reports.length) {
    const report = reportFromRow(operations.reports[0]);
    return {
      processed: false,
      state: report?.blockerCount ? "MISMATCH" as const : "MATCH" as const,
      requestId: request.requestId,
    };
  }
  if (operations.terminals.length) {
    return {
      processed: false,
      state: "FAILED" as const,
      requestId: request.requestId,
      message: safeMessage(
        operations.terminals[0].error_message ||
          object(operations.terminals[0].result_snapshot).message,
      ),
    };
  }

  let planning: ProductPlanningSnapshot;
  let canonical: ProductMasterCanonicalSalesSnapshot;
  try {
    const context = await verifiedContext(request);
    planning = context.planning;
    canonical = context.canonical;
  } catch (error) {
    const message = await storeStepFailure(request, "context", 1, error);
    await storeTerminalFailure(request, "context", message);
    return {
      processed: true,
      state: "FAILED" as const,
      requestId: request.requestId,
      message,
    };
  }

  const completed = new Set(operations.orders.map(operationRangeKey));
  const nextRange = request.ranges.find((range) => !completed.has(rangeKey(range)));
  if (nextRange) {
    const stageKey = `orders:${rangeKey(nextRange)}`;
    const attempt = stageFailureCount(operations.stepFailures, stageKey) + 1;
    if (attempt > MAX_STEP_ATTEMPTS) {
      const message = `CANONICAL_DEMAND_PARITY_RETRY_EXHAUSTED:${rangeKey(nextRange)}`;
      await storeTerminalFailure(request, stageKey, message);
      return {
        processed: true,
        state: "FAILED" as const,
        requestId: request.requestId,
        message,
      };
    }
    try {
      const config = shoplingReadConfigFromEnv(shoplingEnvironment());
      const raw = await new ShoplingReadClient(config).read("orders", nextRange);
      const summary = aggregateShoplingOrderChunk(
        raw,
        planning,
        request.analysisAsOf,
        nextRange,
      );
      await storeOperation({
        operationType: CANONICAL_DEMAND_PARITY_ORDER_CHUNK,
        sourceEventId: `canonical-demand-parity-order:${request.requestId}:${rangeKey(nextRange)}`,
        correlationId: requestCorrelationId(request.requestId),
        inputSnapshot: {
          requestId: request.requestId,
          range: nextRange,
          rangeKey: rangeKey(nextRange),
          analysisAsOf: request.analysisAsOf,
          planningContentFingerprint: request.planningContentFingerprint,
          canonicalContentFingerprint: request.canonicalContentFingerprint,
        },
        resultSnapshot: summary,
      });
      return {
        processed: true,
        state: "RUNNING" as const,
        requestId: request.requestId,
        range: nextRange,
        fetchedRows: summary.fetchedRows,
        acceptedRows: summary.acceptedRows,
      };
    } catch (error) {
      const message = await storeStepFailure(request, stageKey, attempt, error);
      if (attempt >= MAX_STEP_ATTEMPTS) {
        await storeTerminalFailure(request, stageKey, message);
      }
      return {
        processed: true,
        state: attempt >= MAX_STEP_ATTEMPTS ? "FAILED" as const : "RUNNING" as const,
        requestId: request.requestId,
        stageKey,
        attempt,
        message,
      };
    }
  }

  const chunks = operations.orders
    .map(orderChunkFromRow)
    .filter(Boolean) as ShoplingOrderChunkSummary[];
  const report = compareCanonicalDemandWithDirectShopling(
    request,
    planning,
    canonical,
    chunks,
  );
  await storeOperation({
    operationType: CANONICAL_DEMAND_PARITY_REPORT,
    sourceEventId: `canonical-demand-parity-report:${request.requestId}`,
    correlationId: requestCorrelationId(request.requestId),
    inputSnapshot: {
      requestId: request.requestId,
      analysisAsOf: request.analysisAsOf,
      planningContentFingerprint: request.planningContentFingerprint,
      canonicalContentFingerprint: request.canonicalContentFingerprint,
    },
    resultSnapshot: report,
  });
  return {
    processed: true,
    state: report.blockerCount ? "MISMATCH" as const : "MATCH" as const,
    requestId: request.requestId,
    report,
  };
}

export async function loadCanonicalDemandParityStatus(): Promise<CanonicalDemandParityStatus> {
  const configured = canonicalDemandParityConfigured();
  const request = await latestRequest();
  const empty: CanonicalDemandParityStatus = {
    configured,
    requestId: null,
    state: "IDLE",
    stage: "대기",
    message: "Canonical 발주 수요와 Shopling 직접 집계의 동일시점 비교를 아직 시작하지 않았습니다.",
    completedRanges: 0,
    totalRanges: 0,
    progress: 0,
    report: null,
    blockerCount: 0,
    error: null,
  };
  if (!request) return empty;
  const operations = await requestOperations(request);
  const completedRanges = new Set(operations.orders.map(operationRangeKey)).size;
  const report = operations.reports.map(reportFromRow).find(Boolean) ?? null;
  const common = {
    ...empty,
    requestId: request.requestId,
    completedRanges,
    totalRanges: request.ranges.length,
    progress: Math.min(100, Math.round((completedRanges / request.ranges.length) * 100)),
    report,
  };
  if (operations.terminals.length) {
    const error = safeMessage(
      operations.terminals[0].error_message ||
        object(operations.terminals[0].result_snapshot).message,
    );
    return {
      ...common,
      state: "FAILED",
      stage: "비교 실패",
      message: error,
      error,
    };
  }
  if (report) {
    const match = report.blockerCount === 0;
    return {
      ...common,
      state: match ? "MATCH" : "MISMATCH",
      stage: match ? "판매수요 완전일치" : "판매수요 차이 검토",
      message: match
        ? `활성 관리 SKU ${report.exactRowCount}개의 12×30일 수량·매출이 동일 분석시점 Shopling 직접 집계와 완전히 일치합니다.`
        : `수량/매출/누락 범위에서 ${report.blockerCount}개 차단 신호가 발견됐습니다. 자동 전환하지 않고 차이 표본을 검토합니다.`,
      progress: 100,
      blockerCount: report.blockerCount,
    };
  }
  return {
    ...common,
    state: completedRanges ? "RUNNING" : "QUEUED",
    stage: completedRanges ? "동일시점 Shopling 주문 재집계" : "Worker 대기",
    message: `${completedRanges}/${request.ranges.length}개 구간을 읽었습니다. 실제 발주·가격·재고는 변경하지 않습니다.`,
  };
}

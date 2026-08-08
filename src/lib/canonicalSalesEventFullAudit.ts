import { createHash } from "node:crypto";
import {
  PRODUCT_MASTER_SALES_EVENT_ANALYSIS_DAYS,
  PRODUCT_MASTER_SALES_EVENT_FORMAT,
  PRODUCT_MASTER_SALES_EVENT_SOURCE,
  aggregateProductMasterShoplingSalesEventChunk,
  combineProductMasterShoplingSalesEventChunks,
  type ProductMasterSalesEventRow,
  type ProductMasterShoplingSalesEventChunk,
} from "@/lib/productMasterShoplingSalesEventEngine";
import {
  loadProductPlanningSnapshot,
} from "@/lib/productDecisionLiveRefresh";
import {
  buildCandidateRollingRows,
} from "@/lib/stage8CandidateDemandParity";
import {
  type CanonicalRollingSalesRow,
  type ProductMasterCanonicalSalesSnapshot,
} from "@/lib/productMasterCanonicalSalesAudit";
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

export const CANONICAL_EVENT_FULL_AUDIT_REQUEST =
  "CANONICAL_EVENT_FULL_AUDIT_REQUEST";
export const CANONICAL_EVENT_FULL_AUDIT_CHUNK =
  "CANONICAL_EVENT_FULL_AUDIT_CHUNK";
export const CANONICAL_EVENT_FULL_AUDIT_VERIFY =
  "CANONICAL_EVENT_FULL_AUDIT_VERIFY";
export const CANONICAL_EVENT_FULL_AUDIT_REPORT =
  "CANONICAL_EVENT_FULL_AUDIT_REPORT";
export const CANONICAL_EVENT_FULL_AUDIT_FAILURE =
  "CANONICAL_EVENT_FULL_AUDIT_FAILURE";

export const CANONICAL_EVENT_FULL_AUDIT_RANGE_DAYS = 30;
export const CANONICAL_EVENT_FULL_AUDIT_VERIFY_BATCH_SIZE = 1_000;
export const CANONICAL_EVENT_FULL_AUDIT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const CANONICAL_EVENT_FULL_AUDIT_FAILURE_RETRY_MS = 6 * 60 * 60 * 1000;

const DEFAULT_PRODUCT_MASTER_URL = "https://commerce-os-product-master.vercel.app";
const OPERATION_LIMIT = 500;
const MAX_RANGE_ATTEMPTS = 3;
const MAX_EXTERNAL_ID_SAMPLES = 100;
const MAX_ROW_MISMATCH_SAMPLES = 50;
const MANAGED_BARCODE = /^B[A-Z]{2}\d+-\d+$/;

type OperationRow = {
  status?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  error_message?: unknown;
  started_at?: unknown;
};

type FailureSnapshot = {
  rangeKey?: unknown;
  attempt?: unknown;
  message?: unknown;
};

type VerifyBatch = {
  batchIndex: number;
  batchCount: number;
  candidateFingerprint: string;
  candidateRows: number;
  exactMatchedRows: number;
  mismatchCount: number;
  mismatchExternalIds: string[];
};

export type CanonicalSalesEventFullAuditRequest = {
  requestId: string;
  analysisAsOf: string;
  analysisStartDate: string;
  analysisEndDate: string;
  ranges: ShoplingDateRange[];
  planningMappingFingerprint: string;
  baselineReconciliationFingerprint: string;
  createdAt: string;
};

export type CanonicalSalesEventFullAuditRowMismatch = {
  barcode: string;
  unitBuckets: number[];
  revenueBuckets: number[];
  candidateUnits: number[];
  persistedUnits: number[];
  candidateRevenue: number[];
  persistedRevenue: number[];
  candidateValidEventCount: number;
  persistedValidEventCount: number;
};

export type CanonicalSalesEventFullAuditReport = {
  generatedAt: string;
  requestId: string;
  analysisAsOf: string;
  analysisStartDate: string;
  analysisEndDate: string;
  planningMappingFingerprint: string;
  baselineReconciliationFingerprint: string;
  candidateFingerprint: string;
  persistedContentFingerprint: string;
  fetchedRows: number;
  candidateEventCount: number;
  persistedEventCount: number;
  candidateValidCount: number;
  persistedValidCount: number;
  candidateTombstoneCount: number;
  persistedTombstoneCount: number;
  candidateBaseUnits: number;
  candidateRevenue: number;
  persistedExactEventCount: number;
  eventMismatchCount: number;
  eventMismatchExternalIds: string[];
  candidateActiveRowCount: number;
  persistedActiveRowCount: number;
  exactActiveRowCount: number;
  activeRowMismatchCount: number;
  missingPersistedBarcodes: string[];
  extraPersistedBarcodes: string[];
  rowMismatchSamples: CanonicalSalesEventFullAuditRowMismatch[];
  unmappedRows: number;
  identityConflictCount: number;
  orphanEventCount: number;
  classificationComplete: boolean;
  exact: boolean;
  driftCount: number;
  auditFingerprint: string;
  writesEnabled: false;
};

export type CanonicalSalesEventFullAuditStatus = {
  configured: boolean;
  state: "IDLE" | "QUEUED" | "RUNNING" | "EXACT" | "DRIFT" | "BLOCKED" | "FAILED";
  stage: string;
  message: string;
  requestId: string | null;
  analysisAsOf: string | null;
  completedRanges: number;
  totalRanges: number;
  verifiedBatches: number;
  totalVerifyBatches: number;
  progress: number;
  report: CanonicalSalesEventFullAuditReport | null;
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

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function rangeKey(range: ShoplingDateRange) {
  return `${range.start}:${range.end}`;
}

function correlationId(requestId: string) {
  return `canonical-sales-event-full-audit:${requestId}`;
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
  if (!/^https:\/\//.test(baseUrl)) throw new Error("PRODUCT_MASTER_BASE_URL_INVALID");
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

export function canonicalSalesEventFullAuditConfigured() {
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
      `${left.barcode}\u0000${left.skuId}`.localeCompare(`${right.barcode}\u0000${right.skuId}`),
    );
  return `sha256:${createHash("sha256").update(JSON.stringify(normalized)).digest("hex")}`;
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

function arraysEqual(left: number[], right: number[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => integer(value) === integer(right[index]));
}

function differingBuckets(left: number[], right: number[]) {
  const length = Math.max(left.length, right.length);
  const output: number[] = [];
  for (let index = 0; index < length; index += 1) {
    if (integer(left[index]) !== integer(right[index])) output.push(index);
  }
  return output;
}

async function storeOperation(input: {
  operationType: string;
  sourceEventId: string;
  correlationId: string;
  status?: "SUCCEEDED" | "FAILED";
  inputSnapshot: unknown;
  resultSnapshot: unknown;
  errorMessage?: string | null;
  occurredAt?: string;
}) {
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
          source: "ops-center-canonical-sales-event-full-audit",
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
    throw new Error(`CANONICAL_EVENT_FULL_AUDIT_STORE_FAILED:${response.status}:${body.slice(0, 300)}`);
  }
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
    .select("status,input_snapshot,result_snapshot,error_message,started_at")
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
    !ranges.length ||
    !/^sha256:[a-f0-9]{64}$/.test(planningMappingFingerprint) ||
    !/^sha256:[a-f0-9]{64}$/.test(baselineReconciliationFingerprint)
  ) return null;
  return {
    requestId,
    analysisAsOf,
    analysisStartDate: text(value.analysisStartDate),
    analysisEndDate: text(value.analysisEndDate),
    ranges,
    planningMappingFingerprint,
    baselineReconciliationFingerprint,
    createdAt,
  } satisfies CanonicalSalesEventFullAuditRequest;
}

function chunkFromRow(row: OperationRow) {
  const value = object(row.result_snapshot);
  return value.range && Array.isArray(value.events)
    ? (value as unknown as ProductMasterShoplingSalesEventChunk)
    : null;
}

function verifyFromRow(row: OperationRow): VerifyBatch | null {
  const input = object(row.input_snapshot);
  const output = object(row.result_snapshot);
  const batchCount = integer(input.batchCount);
  const fingerprint = text(input.candidateFingerprint);
  if (!batchCount || !/^sha256:[a-f0-9]{64}$/.test(fingerprint)) return null;
  return {
    batchIndex: integer(input.batchIndex),
    batchCount,
    candidateFingerprint: fingerprint,
    candidateRows: integer(output.candidateRows),
    exactMatchedRows: integer(output.exactMatchedRows),
    mismatchCount: integer(output.mismatchCount),
    mismatchExternalIds: Array.isArray(output.mismatchExternalIds)
      ? output.mismatchExternalIds.map(text).filter(Boolean)
      : [],
  };
}

function reportFromRow(row: OperationRow) {
  const value = object(row.result_snapshot);
  return /^sha256:[a-f0-9]{64}$/.test(text(value.auditFingerprint))
    ? (value as unknown as CanonicalSalesEventFullAuditReport)
    : null;
}

async function latestRequest() {
  const rows = await readOperations(CANONICAL_EVENT_FULL_AUDIT_REQUEST, undefined, 20);
  for (const row of rows) {
    const request = requestFromRow(row);
    if (request) return request;
  }
  return null;
}

async function requestOperations(request: CanonicalSalesEventFullAuditRequest) {
  const cid = correlationId(request.requestId);
  const [chunks, verifies, reports, failures] = await Promise.all([
    readOperations(CANONICAL_EVENT_FULL_AUDIT_CHUNK, cid),
    readOperations(CANONICAL_EVENT_FULL_AUDIT_VERIFY, cid),
    readOperations(CANONICAL_EVENT_FULL_AUDIT_REPORT, cid, 5),
    readOperations(CANONICAL_EVENT_FULL_AUDIT_FAILURE, cid, 30),
  ]);
  return { cid, chunks, verifies, reports, failures };
}

function failureAttempt(row: OperationRow) {
  const input = object(row.input_snapshot) as FailureSnapshot;
  return {
    rangeKey: text(input.rangeKey),
    attempt: integer(input.attempt),
  };
}

async function failRequest(
  request: CanonicalSalesEventFullAuditRequest,
  stage: string,
  error: unknown,
) {
  const message = safeMessage(error);
  await storeOperation({
    operationType: CANONICAL_EVENT_FULL_AUDIT_FAILURE,
    sourceEventId: `canonical-event-full-audit-failure:${request.requestId}:${encodeURIComponent(stage)}`,
    correlationId: correlationId(request.requestId),
    status: "FAILED",
    inputSnapshot: { requestId: request.requestId, stage },
    resultSnapshot: { state: "FAILED", message, writesEnabled: false },
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
    throw new Error(text(payload.message) || `CANONICAL_EVENT_FULL_AUDIT_VERIFY_FAILED:${response.status}`);
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
    throw new Error(`CANONICAL_EVENT_FULL_AUDIT_VERIFY_ACCOUNTING_INVALID:${events.length}:${exactMatchedRows}:${mismatchCount}`);
  }
  const ids = new Set(events.map((event) => event.externalId));
  if (mismatchExternalIds.some((id) => !ids.has(id))) {
    throw new Error("CANONICAL_EVENT_FULL_AUDIT_FOREIGN_MISMATCH_ID");
  }
  return { exactMatchedRows, mismatchCount, mismatchExternalIds };
}

function normalizeCanonicalSnapshot(value: Record<string, unknown>): ProductMasterCanonicalSalesSnapshot {
  return {
    ok: true,
    generatedAt: text(value.generatedAt),
    analysisAsOf: text(value.analysisAsOf),
    source: text(value.source),
    bucketDays: integer(value.bucketDays),
    bucketCount: integer(value.bucketCount),
    managedActiveSkuCount: integer(value.managedActiveSkuCount),
    sourceEventCount: integer(value.sourceEventCount),
    validEventCount: integer(value.validEventCount),
    tombstoneCount: integer(value.tombstoneCount),
    inactiveManagedHistoricalEventCount: integer(value.inactiveManagedHistoricalEventCount),
    inactiveManagedValidEventCount: integer(value.inactiveManagedValidEventCount),
    inactiveManagedTombstoneCount: integer(value.inactiveManagedTombstoneCount),
    inactiveManagedHistoricalSamples: Array.isArray(value.inactiveManagedHistoricalSamples)
      ? (value.inactiveManagedHistoricalSamples as ProductMasterCanonicalSalesSnapshot["inactiveManagedHistoricalSamples"])
      : [],
    orphanEventCount: integer(value.orphanEventCount),
    classifiedEventCount: integer(value.classifiedEventCount),
    classificationComplete: value.classificationComplete === true,
    contentFingerprint: text(value.contentFingerprint),
    rows: Array.isArray(value.rows)
      ? (value.rows as CanonicalRollingSalesRow[])
      : [],
    writesEnabled: false,
  };
}

async function loadCanonicalSnapshot(analysisAsOf: string) {
  const { baseUrl, secret } = productMasterConnection();
  const response = await fetch(
    `${baseUrl}/api/integrations/sales-events?analysisAsOf=${encodeURIComponent(analysisAsOf)}`,
    {
      headers: {
        accept: "application/json",
        "x-commerce-os-integration-secret": secret,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || payload.ok !== true) {
    throw new Error(text(payload.message) || `CANONICAL_EVENT_FULL_AUDIT_SNAPSHOT_FAILED:${response.status}`);
  }
  return normalizeCanonicalSnapshot(payload);
}

function compareActiveRows(
  candidateRows: ReturnType<typeof buildCandidateRollingRows>,
  persistedRows: CanonicalRollingSalesRow[],
) {
  const candidateByBarcode = new Map(candidateRows.map((row) => [row.barcode, row]));
  const persistedByBarcode = new Map(
    persistedRows.map((row) => [text(row.barcode).toUpperCase(), row]),
  );
  const missingPersistedBarcodes: string[] = [];
  const rowMismatchSamples: CanonicalSalesEventFullAuditRowMismatch[] = [];
  let exactActiveRowCount = 0;

  for (const candidate of candidateRows) {
    const persisted = persistedByBarcode.get(candidate.barcode);
    if (!persisted) {
      missingPersistedBarcodes.push(candidate.barcode);
      continue;
    }
    const unitsMatch = arraysEqual(candidate.monthlyUnits, persisted.monthlyUnits);
    const revenueMatch = arraysEqual(candidate.monthlyRevenue, persisted.monthlyRevenue);
    const validCountMatch = integer(candidate.validEventCount) === integer(persisted.validEventCount);
    if (unitsMatch && revenueMatch && validCountMatch) {
      exactActiveRowCount += 1;
      continue;
    }
    if (rowMismatchSamples.length < MAX_ROW_MISMATCH_SAMPLES) {
      rowMismatchSamples.push({
        barcode: candidate.barcode,
        unitBuckets: differingBuckets(candidate.monthlyUnits, persisted.monthlyUnits),
        revenueBuckets: differingBuckets(candidate.monthlyRevenue, persisted.monthlyRevenue),
        candidateUnits: candidate.monthlyUnits.map(integer),
        persistedUnits: persisted.monthlyUnits.map(integer),
        candidateRevenue: candidate.monthlyRevenue.map(integer),
        persistedRevenue: persisted.monthlyRevenue.map(integer),
        candidateValidEventCount: integer(candidate.validEventCount),
        persistedValidEventCount: integer(persisted.validEventCount),
      });
    }
  }
  const extraPersistedBarcodes = [...persistedByBarcode.keys()]
    .filter((barcode) => !candidateByBarcode.has(barcode))
    .sort();
  const activeRowMismatchCount =
    candidateRows.length - exactActiveRowCount - missingPersistedBarcodes.length;
  return {
    exactActiveRowCount,
    activeRowMismatchCount,
    missingPersistedBarcodes,
    extraPersistedBarcodes,
    rowMismatchSamples,
  };
}

function makeAuditFingerprint(report: Omit<CanonicalSalesEventFullAuditReport, "auditFingerprint">) {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        analysisAsOf: report.analysisAsOf,
        planningMappingFingerprint: report.planningMappingFingerprint,
        candidateFingerprint: report.candidateFingerprint,
        persistedContentFingerprint: report.persistedContentFingerprint,
        candidateEventCount: report.candidateEventCount,
        persistedEventCount: report.persistedEventCount,
        eventMismatchCount: report.eventMismatchCount,
        exactActiveRowCount: report.exactActiveRowCount,
        activeRowMismatchCount: report.activeRowMismatchCount,
        missingPersistedBarcodes: report.missingPersistedBarcodes,
        extraPersistedBarcodes: report.extraPersistedBarcodes,
        unmappedRows: report.unmappedRows,
        identityConflictCount: report.identityConflictCount,
        orphanEventCount: report.orphanEventCount,
        exact: report.exact,
      }),
    )
    .digest("hex")}`;
}

export async function createCanonicalSalesEventFullAuditRequest(now = new Date()) {
  if (!canonicalSalesEventFullAuditConfigured()) {
    throw new Error("CANONICAL_EVENT_FULL_AUDIT_NOT_CONFIGURED");
  }
  const reconciliation = await loadPostApplyCanonicalReconciliation();
  if (!reconciliation.ready || !reconciliation.reconciliationFingerprint) {
    throw new Error(`CANONICAL_EVENT_FULL_AUDIT_BASELINE_REQUIRED:${reconciliation.state}`);
  }
  const planning = await loadProductPlanningSnapshot();
  const analysisAsOf = now.toISOString();
  const start = new Date(
    now.getTime() - PRODUCT_MASTER_SALES_EVENT_ANALYSIS_DAYS * 24 * 60 * 60 * 1000,
  );
  const request: CanonicalSalesEventFullAuditRequest = {
    requestId: crypto.randomUUID(),
    analysisAsOf,
    analysisStartDate: dateOnly(start),
    analysisEndDate: dateOnly(now),
    ranges: splitShoplingDateRange(
      dateOnly(start),
      dateOnly(now),
      CANONICAL_EVENT_FULL_AUDIT_RANGE_DAYS,
    ),
    planningMappingFingerprint: planningMappingFingerprint(planning.products),
    baselineReconciliationFingerprint: reconciliation.reconciliationFingerprint,
    createdAt: analysisAsOf,
  };
  await storeOperation({
    operationType: CANONICAL_EVENT_FULL_AUDIT_REQUEST,
    sourceEventId: `canonical-event-full-audit-request:${request.requestId}`,
    correlationId: correlationId(request.requestId),
    inputSnapshot: request,
    resultSnapshot: {
      state: "QUEUED",
      accepted: true,
      analysisDays: PRODUCT_MASTER_SALES_EVENT_ANALYSIS_DAYS,
      writesEnabled: false,
    },
    occurredAt: request.createdAt,
  });
  return request;
}

export async function runCanonicalSalesEventFullAuditStep() {
  const request = await latestRequest();
  if (!request) return { processed: false, state: "IDLE" as const };
  const operations = await requestOperations(request);
  if (operations.reports.length) {
    const report = operations.reports.map(reportFromRow).find(Boolean);
    return {
      processed: false,
      state: report?.exact ? "EXACT" as const : "DRIFT" as const,
      requestId: request.requestId,
    };
  }
  const terminalFailure = operations.failures.find((row) => text(row.status) === "FAILED");
  if (terminalFailure) {
    return {
      processed: false,
      state: "FAILED" as const,
      requestId: request.requestId,
      message: safeMessage(terminalFailure.error_message || object(terminalFailure.result_snapshot).message),
    };
  }

  const planning = await loadProductPlanningSnapshot();
  const currentMappingFingerprint = planningMappingFingerprint(planning.products);
  if (currentMappingFingerprint !== request.planningMappingFingerprint) {
    return failRequest(
      request,
      "MAPPING_CHANGED",
      "360일 full audit 진행 중 SKU/Shopling identity 구조가 바뀌어 서로 다른 기준을 섞지 않도록 중단했습니다.",
    );
  }

  const chunks = operations.chunks
    .map(chunkFromRow)
    .filter(Boolean) as ProductMasterShoplingSalesEventChunk[];
  const completed = new Set(chunks.map((chunk) => rangeKey(chunk.range)));
  const nextRange = request.ranges.find((range) => !completed.has(rangeKey(range)));
  if (nextRange) {
    const key = rangeKey(nextRange);
    const attempts = operations.failures
      .map(failureAttempt)
      .filter((failure) => failure.rangeKey === key);
    if (attempts.length >= MAX_RANGE_ATTEMPTS) {
      return failRequest(
        request,
        `RANGE_RETRY_EXHAUSTED:${key}`,
        `${key} Shopling 360일 audit 조회가 ${MAX_RANGE_ATTEMPTS}회 실패했습니다.`,
      );
    }
    try {
      const config = shoplingReadConfigFromEnv(shoplingEnvironment());
      const raw = await new ShoplingReadClient(config).read("orders", nextRange);
      const summary = aggregateProductMasterShoplingSalesEventChunk(
        raw,
        planning,
        nextRange,
        { analysisAsOf: request.analysisAsOf, syncedAt: request.analysisAsOf },
      );
      await storeOperation({
        operationType: CANONICAL_EVENT_FULL_AUDIT_CHUNK,
        sourceEventId: `canonical-event-full-audit-chunk:${request.requestId}:${key}`,
        correlationId: operations.cid,
        inputSnapshot: {
          requestId: request.requestId,
          range: nextRange,
          rangeKey: key,
          planningMappingFingerprint: request.planningMappingFingerprint,
        },
        resultSnapshot: summary,
      });
      return {
        processed: true,
        state: "RUNNING" as const,
        phase: "SOURCE_READ" as const,
        range: nextRange,
        fetchedRows: summary.fetchedRows,
        eventRows: summary.eventRows,
      };
    } catch (error) {
      const attempt = attempts.length + 1;
      const message = safeMessage(error);
      await storeOperation({
        operationType: CANONICAL_EVENT_FULL_AUDIT_FAILURE,
        sourceEventId: `canonical-event-full-audit-range-retry:${request.requestId}:${key}:${attempt}`,
        correlationId: operations.cid,
        status: "SUCCEEDED",
        inputSnapshot: { requestId: request.requestId, rangeKey: key, attempt },
        resultSnapshot: { retryPending: true, message },
        errorMessage: message,
      });
      return {
        processed: false,
        state: "RUNNING" as const,
        phase: "SOURCE_RETRY" as const,
        attempt,
        message,
      };
    }
  }

  const combined = combineProductMasterShoplingSalesEventChunks(chunks);
  if (combined.unmappedRows || combined.conflictExternalIds.length) {
    return failRequest(
      request,
      "SOURCE_BLOCKERS",
      `360일 full audit source 차단: 미연결 ${combined.unmappedRows}건 · identity/time 충돌 ${combined.conflictExternalIds.length}건.`,
    );
  }
  const fingerprint = candidateFingerprint(combined.events);
  const batchCount = Math.max(
    1,
    Math.ceil(combined.events.length / CANONICAL_EVENT_FULL_AUDIT_VERIFY_BATCH_SIZE),
  );
  const verifyRows = operations.verifies.map(verifyFromRow).filter(Boolean) as VerifyBatch[];
  if (verifyRows.some((row) => row.candidateFingerprint !== fingerprint || row.batchCount !== batchCount)) {
    return failRequest(
      request,
      "VERIFY_FINGERPRINT_DRIFT",
      "360일 full audit verify batch와 현재 candidate fingerprint가 달라 중단했습니다.",
    );
  }
  const verifiedIndexes = new Set(verifyRows.map((row) => row.batchIndex));
  const nextBatchIndex = Array.from({ length: batchCount }, (_, index) => index).find(
    (index) => !verifiedIndexes.has(index),
  );
  if (nextBatchIndex !== undefined) {
    const start = nextBatchIndex * CANONICAL_EVENT_FULL_AUDIT_VERIFY_BATCH_SIZE;
    const batch = combined.events.slice(start, start + CANONICAL_EVENT_FULL_AUDIT_VERIFY_BATCH_SIZE);
    if (!batch.length && combined.events.length !== 0) {
      return failRequest(request, "VERIFY_EMPTY_BATCH", `Verify batch ${nextBatchIndex}/${batchCount}가 비어 있습니다.`);
    }
    try {
      const verification = batch.length
        ? await verifyProductMasterEvents(batch)
        : { exactMatchedRows: 0, mismatchCount: 0, mismatchExternalIds: [] as string[] };
      await storeOperation({
        operationType: CANONICAL_EVENT_FULL_AUDIT_VERIFY,
        sourceEventId: `canonical-event-full-audit-verify:${request.requestId}:${fingerprint}:${nextBatchIndex}`,
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
      };
    } catch (error) {
      return failRequest(request, `VERIFY:${nextBatchIndex}`, error);
    }
  }

  try {
    const refreshed = await requestOperations(request);
    const finalVerifyRows = refreshed.verifies.map(verifyFromRow).filter(Boolean) as VerifyBatch[];
    const verifiedByIndex = new Map(finalVerifyRows.map((row) => [row.batchIndex, row]));
    if (verifiedByIndex.size !== batchCount) {
      throw new Error(`FULL_AUDIT_VERIFY_COVERAGE:${verifiedByIndex.size}:${batchCount}`);
    }
    const mismatchIds = [...verifiedByIndex.values()].flatMap((row) => row.mismatchExternalIds);
    const uniqueMismatchIds = [...new Set(mismatchIds)].sort();
    const exactMatchedRows = [...verifiedByIndex.values()].reduce(
      (sum, row) => sum + row.exactMatchedRows,
      0,
    );
    if (exactMatchedRows + uniqueMismatchIds.length !== combined.events.length) {
      throw new Error(
        `FULL_AUDIT_EVENT_ACCOUNTING:${combined.events.length}:${exactMatchedRows}:${uniqueMismatchIds.length}`,
      );
    }

    const persisted = await loadCanonicalSnapshot(request.analysisAsOf);
    if (
      persisted.analysisAsOf !== request.analysisAsOf ||
      persisted.bucketDays !== 30 ||
      persisted.bucketCount !== 12
    ) {
      throw new Error("FULL_AUDIT_CANONICAL_SNAPSHOT_CONTEXT_INVALID");
    }
    const candidateRows = buildCandidateRollingRows(
      planning,
      combined.events,
      request.analysisAsOf,
    );
    const rowComparison = compareActiveRows(candidateRows, persisted.rows);
    const candidateValid = combined.events.filter((event) => event.validSale);
    const candidateValidCount = candidateValid.length;
    const candidateTombstoneCount = combined.events.length - candidateValidCount;
    const persistedValidCount =
      persisted.validEventCount + persisted.inactiveManagedValidEventCount;
    const persistedTombstoneCount =
      persisted.tombstoneCount + persisted.inactiveManagedTombstoneCount;
    const driftCount = [
      uniqueMismatchIds.length,
      Math.abs(combined.events.length - persisted.sourceEventCount),
      Math.abs(candidateValidCount - persistedValidCount),
      Math.abs(candidateTombstoneCount - persistedTombstoneCount),
      persisted.orphanEventCount,
      persisted.classificationComplete ? 0 : 1,
      rowComparison.activeRowMismatchCount,
      rowComparison.missingPersistedBarcodes.length,
      rowComparison.extraPersistedBarcodes.length,
    ].reduce((sum, value) => sum + integer(value), 0);
    const exact =
      uniqueMismatchIds.length === 0 &&
      combined.events.length === persisted.sourceEventCount &&
      candidateValidCount === persistedValidCount &&
      candidateTombstoneCount === persistedTombstoneCount &&
      persisted.orphanEventCount === 0 &&
      persisted.classificationComplete &&
      candidateRows.length === persisted.rows.length &&
      rowComparison.exactActiveRowCount === candidateRows.length &&
      rowComparison.activeRowMismatchCount === 0 &&
      rowComparison.missingPersistedBarcodes.length === 0 &&
      rowComparison.extraPersistedBarcodes.length === 0;

    const withoutFingerprint: Omit<CanonicalSalesEventFullAuditReport, "auditFingerprint"> = {
      generatedAt: new Date().toISOString(),
      requestId: request.requestId,
      analysisAsOf: request.analysisAsOf,
      analysisStartDate: request.analysisStartDate,
      analysisEndDate: request.analysisEndDate,
      planningMappingFingerprint: request.planningMappingFingerprint,
      baselineReconciliationFingerprint: request.baselineReconciliationFingerprint,
      candidateFingerprint: fingerprint,
      persistedContentFingerprint: persisted.contentFingerprint,
      fetchedRows: combined.fetchedRows,
      candidateEventCount: combined.events.length,
      persistedEventCount: persisted.sourceEventCount,
      candidateValidCount,
      persistedValidCount,
      candidateTombstoneCount,
      persistedTombstoneCount,
      candidateBaseUnits: candidateValid.reduce((sum, event) => sum + integer(event.quantity), 0),
      candidateRevenue: candidateValid.reduce((sum, event) => sum + integer(event.revenue), 0),
      persistedExactEventCount: exactMatchedRows,
      eventMismatchCount: uniqueMismatchIds.length,
      eventMismatchExternalIds: uniqueMismatchIds.slice(0, MAX_EXTERNAL_ID_SAMPLES),
      candidateActiveRowCount: candidateRows.length,
      persistedActiveRowCount: persisted.rows.length,
      exactActiveRowCount: rowComparison.exactActiveRowCount,
      activeRowMismatchCount: rowComparison.activeRowMismatchCount,
      missingPersistedBarcodes: rowComparison.missingPersistedBarcodes,
      extraPersistedBarcodes: rowComparison.extraPersistedBarcodes,
      rowMismatchSamples: rowComparison.rowMismatchSamples,
      unmappedRows: combined.unmappedRows,
      identityConflictCount: combined.conflictExternalIds.length,
      orphanEventCount: persisted.orphanEventCount,
      classificationComplete: persisted.classificationComplete,
      exact,
      driftCount,
      writesEnabled: false,
    };
    const report: CanonicalSalesEventFullAuditReport = {
      ...withoutFingerprint,
      auditFingerprint: makeAuditFingerprint(withoutFingerprint),
    };
    await storeOperation({
      operationType: CANONICAL_EVENT_FULL_AUDIT_REPORT,
      sourceEventId: `canonical-event-full-audit-report:${request.requestId}:${report.auditFingerprint}`,
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
      state: exact ? "EXACT" as const : "DRIFT" as const,
      report,
      message: exact
        ? `최근 360일 candidate ${report.candidateEventCount}건과 Product Master persisted canonical 원장이 externalId·이벤트 집계·332개 active 12×30 배열까지 완전히 일치합니다.`
        : `360일 full audit에서 drift ${report.driftCount}점이 발견됐습니다. 신규/변경 ${report.eventMismatchCount}건 · active 배열 불일치 ${report.activeRowMismatchCount}건이며 실제 쓰기는 차단됩니다.`,
    };
  } catch (error) {
    return failRequest(request, "FINAL_RECONCILIATION", error);
  }
}

export async function ensureCanonicalSalesEventFullAuditRequest(now = new Date()) {
  const latest = await latestRequest();
  if (latest) {
    const operations = await requestOperations(latest);
    const report = operations.reports.map(reportFromRow).find(Boolean) ?? null;
    const terminalFailure = operations.failures.find((row) => text(row.status) === "FAILED");
    if (!report && !terminalFailure) {
      return {
        created: false,
        state: "RUNNING" as const,
        requestId: latest.requestId,
        message: "기존 360일 full audit를 이어서 처리합니다.",
      };
    }
    if (report) {
      const age = now.getTime() - Date.parse(report.generatedAt);
      if (age < CANONICAL_EVENT_FULL_AUDIT_INTERVAL_MS) {
        return {
          created: false,
          state: "IDLE" as const,
          requestId: latest.requestId,
          lastCompletedAt: report.generatedAt,
          message: "최근 360일 full audit 완료 후 7일이 지나지 않아 재실행을 생략합니다.",
        };
      }
    }
    if (terminalFailure) {
      const failedAt = iso(terminalFailure.started_at);
      if (
        failedAt &&
        now.getTime() - Date.parse(failedAt) < CANONICAL_EVENT_FULL_AUDIT_FAILURE_RETRY_MS
      ) {
        return {
          created: false,
          state: "FAILED" as const,
          requestId: latest.requestId,
          lastFailureAt: failedAt,
          message: "최근 360일 full audit 실패 후 6시간 보호대기 중입니다.",
        };
      }
    }
  }
  const request = await createCanonicalSalesEventFullAuditRequest(now);
  return {
    created: true,
    state: "QUEUED" as const,
    requestId: request.requestId,
    message: "최근 360일 exact-event full audit를 접수했습니다.",
  };
}

export async function loadCanonicalSalesEventFullAuditStatus(): Promise<CanonicalSalesEventFullAuditStatus> {
  const configured = canonicalSalesEventFullAuditConfigured();
  const request = await latestRequest();
  const empty: CanonicalSalesEventFullAuditStatus = {
    configured,
    state: "IDLE",
    stage: "대기",
    message: "360일 exact-event full audit 요청이 아직 없습니다.",
    requestId: null,
    analysisAsOf: null,
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
  const chunks = operations.chunks.map(chunkFromRow).filter(Boolean) as ProductMasterShoplingSalesEventChunk[];
  const completedRanges = new Set(chunks.map((chunk) => rangeKey(chunk.range))).size;
  const combined = combineProductMasterShoplingSalesEventChunks(chunks);
  const batchCount = completedRanges === request.ranges.length
    ? Math.max(1, Math.ceil(combined.events.length / CANONICAL_EVENT_FULL_AUDIT_VERIFY_BATCH_SIZE))
    : 0;
  const verifyRows = operations.verifies.map(verifyFromRow).filter(Boolean) as VerifyBatch[];
  const verifiedBatches = new Set(verifyRows.map((row) => row.batchIndex)).size;
  const report = operations.reports.map(reportFromRow).find(Boolean) ?? null;
  const terminalFailure = operations.failures.find((row) => text(row.status) === "FAILED");
  const totalUnits = request.ranges.length + batchCount + 1;
  const completedUnits = completedRanges + verifiedBatches + (report ? 1 : 0);
  const common = {
    ...empty,
    requestId: request.requestId,
    analysisAsOf: request.analysisAsOf,
    completedRanges,
    totalRanges: request.ranges.length,
    verifiedBatches,
    totalVerifyBatches: batchCount,
    progress: totalUnits ? Math.min(100, Math.round((completedUnits / totalUnits) * 100)) : 0,
    report,
  };
  if (terminalFailure) {
    const error = safeMessage(terminalFailure.error_message || object(terminalFailure.result_snapshot).message);
    return { ...common, state: "FAILED", stage: "Full audit 실패", message: error, error };
  }
  if (report) {
    return {
      ...common,
      state: report.exact ? "EXACT" : "DRIFT",
      stage: report.exact ? "360일 persisted exact" : "360일 drift 발견",
      message: report.exact
        ? `360일 candidate ${report.candidateEventCount}건과 persisted canonical 원장이 완전히 일치합니다.`
        : `신규/변경 ${report.eventMismatchCount}건 · active 배열 불일치 ${report.activeRowMismatchCount}건 · missing ${report.missingPersistedBarcodes.length} · extra ${report.extraPersistedBarcodes.length}.`,
      progress: 100,
    };
  }
  if (completedRanges < request.ranges.length) {
    return {
      ...common,
      state: completedRanges ? "RUNNING" : "QUEUED",
      stage: completedRanges ? "360일 Shopling source 수집 중" : "예약 Worker 대기",
      message: `${completedRanges}/${request.ranges.length}개 30일 source range를 읽었습니다.`,
    };
  }
  if (combined.unmappedRows || combined.conflictExternalIds.length) {
    return {
      ...common,
      state: "BLOCKED",
      stage: "Source identity 차단",
      message: `미연결 ${combined.unmappedRows}건 · identity/time 충돌 ${combined.conflictExternalIds.length}건.`,
    };
  }
  return {
    ...common,
    state: "RUNNING",
    stage: "Product Master persisted 360일 대조 중",
    message: `${verifiedBatches}/${batchCount}개 event verify batch를 확인했습니다.`,
  };
}

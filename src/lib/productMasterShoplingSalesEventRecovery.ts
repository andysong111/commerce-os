import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { splitShoplingDateRange } from "@/lib/shopling/shoplingReadClient";
import {
  createSupabaseAdminClient,
  createSupabaseAdminHeaders,
} from "@/lib/supabase/admin";
import {
  SALES_EVENT_CHUNK,
  SALES_EVENT_FAILED,
  SALES_EVENT_REQUEST,
} from "@/lib/productMasterShoplingSalesEventSync";

export const SALES_EVENT_DEFAULT_CHUNK_DAYS = 30;
export const SALES_EVENT_FALLBACK_CHUNK_DAYS = 7;
export const SALES_EVENT_MINIMUM_CHUNK_DAYS = 2;
export const SALES_EVENT_MAX_REQUEST_ATTEMPTS_PER_TIER = 3;

const OPERATION_LIMIT = 500;

type OperationRow = {
  operation_type?: unknown;
  correlation_id?: unknown;
  status?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  error_message?: unknown;
  started_at?: unknown;
};

type RecoveryRequest = {
  requestId: string;
  analysisAsOf: string;
  analysisStartDate: string;
  analysisEndDate: string;
  planningGeneratedAt: string;
  planningContentFingerprint: string;
  chunkDays: number;
  supersedesRequestId: string | null;
  ranges: Array<{ start: string; end: string }>;
  createdAt: string;
};

type ReusableChunk = {
  rangeKey: string;
  inputSnapshot: Record<string, unknown>;
  resultSnapshot: Record<string, unknown>;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function requestCorrelationId(requestId: string) {
  return `product-master-sales-events:${requestId}`;
}

function rangeKey(range: { start: string; end: string }) {
  return `${range.start}:${range.end}`;
}

function operationRangeKey(row: OperationRow) {
  const input = object(row.input_snapshot);
  const range = object(input.range);
  const start = text(range.start);
  const end = text(range.end);
  return start && end ? `${start}:${end}` : text(input.rangeKey);
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

async function readOperations(operationType: string, limit = OPERATION_LIMIT) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const result = await admin
    .from("commerce_operation_runs")
    .select(
      "operation_type,correlation_id,status,input_snapshot,result_snapshot,error_message,started_at",
    )
    .eq("operation_type", operationType)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (result.error) throw new Error(result.error.message);
  return (Array.isArray(result.data) ? result.data : []).filter(
    (row): row is OperationRow => Boolean(row && typeof row === "object"),
  );
}

function parseRequest(row: OperationRow) {
  const input = object(row.input_snapshot);
  const requestId = text(input.requestId);
  const analysisAsOf = iso(input.analysisAsOf);
  const analysisStartDate = text(input.analysisStartDate);
  const analysisEndDate = text(input.analysisEndDate);
  const planningGeneratedAt = iso(input.planningGeneratedAt);
  const planningContentFingerprint = text(input.planningContentFingerprint);
  const ranges = Array.isArray(input.ranges) ? input.ranges : [];
  if (
    !requestId ||
    !analysisAsOf ||
    !/^\d{4}-\d{2}-\d{2}$/.test(analysisStartDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(analysisEndDate) ||
    !planningGeneratedAt ||
    !/^sha256:[a-f0-9]{64}$/.test(planningContentFingerprint) ||
    !ranges.length
  ) {
    return null;
  }
  const rawChunkDays = Math.round(number(input.chunkDays));
  const chunkDays = [
    SALES_EVENT_DEFAULT_CHUNK_DAYS,
    SALES_EVENT_FALLBACK_CHUNK_DAYS,
    SALES_EVENT_MINIMUM_CHUNK_DAYS,
  ].includes(rawChunkDays)
    ? rawChunkDays
    : SALES_EVENT_DEFAULT_CHUNK_DAYS;
  return {
    requestId,
    analysisAsOf,
    analysisStartDate,
    analysisEndDate,
    planningGeneratedAt,
    planningContentFingerprint,
    chunkDays,
    supersedesRequestId: text(input.supersedesRequestId) || null,
    createdAt: iso(input.createdAt) || analysisAsOf,
  };
}

async function latestRequests() {
  const requestRows = await readOperations(SALES_EVENT_REQUEST);
  return requestRows
    .map(parseRequest)
    .filter(Boolean) as Array<NonNullable<ReturnType<typeof parseRequest>>>;
}

async function hasTerminalFailure(requestId: string) {
  const rows = await readOperations(SALES_EVENT_FAILED, 100);
  const correlationId = requestCorrelationId(requestId);
  return rows.some(
    (row) =>
      text(row.correlation_id) === correlationId &&
      text(row.status).toUpperCase() === "FAILED",
  );
}

function tierAttemptCount(
  latest: NonNullable<ReturnType<typeof parseRequest>>,
  requestsById: Map<string, NonNullable<ReturnType<typeof parseRequest>>>,
) {
  let count = 0;
  let cursor: NonNullable<ReturnType<typeof parseRequest>> | undefined = latest;
  const visited = new Set<string>();
  while (
    cursor &&
    cursor.chunkDays === latest.chunkDays &&
    !visited.has(cursor.requestId)
  ) {
    visited.add(cursor.requestId);
    count += 1;
    cursor = cursor.supersedesRequestId
      ? requestsById.get(cursor.supersedesRequestId)
      : undefined;
  }
  return count;
}

function nextChunkDays(chunkDays: number) {
  if (chunkDays === SALES_EVENT_DEFAULT_CHUNK_DAYS) {
    return SALES_EVENT_FALLBACK_CHUNK_DAYS;
  }
  if (chunkDays === SALES_EVENT_FALLBACK_CHUNK_DAYS) {
    return SALES_EVENT_MINIMUM_CHUNK_DAYS;
  }
  return null;
}

function canReuseChunks(
  child: NonNullable<ReturnType<typeof parseRequest>> | RecoveryRequest,
  parent: NonNullable<ReturnType<typeof parseRequest>>,
) {
  return (
    child.chunkDays === parent.chunkDays &&
    child.analysisAsOf === parent.analysisAsOf &&
    child.analysisStartDate === parent.analysisStartDate &&
    child.analysisEndDate === parent.analysisEndDate &&
    child.planningContentFingerprint === parent.planningContentFingerprint
  );
}

async function reusableParentChunks(
  child: NonNullable<ReturnType<typeof parseRequest>> | RecoveryRequest,
  parent: NonNullable<ReturnType<typeof parseRequest>> | undefined,
) {
  if (!parent || !canReuseChunks(child, parent)) return [] as ReusableChunk[];
  const parentCorrelationId = requestCorrelationId(parent.requestId);
  const allowed = new Set(child.ranges.map(rangeKey));
  const rows = await readOperations(SALES_EVENT_CHUNK);
  const byRange = new Map<string, ReusableChunk>();
  for (const row of rows) {
    if (text(row.correlation_id) !== parentCorrelationId) continue;
    const key = operationRangeKey(row);
    if (!allowed.has(key) || byRange.has(key)) continue;
    const input = object(row.input_snapshot);
    const result = object(row.result_snapshot);
    if (
      text(input.planningContentFingerprint) !== child.planningContentFingerprint ||
      !Array.isArray(result.events)
    ) {
      continue;
    }
    const resultRange = object(result.range);
    if (`${text(resultRange.start)}:${text(resultRange.end)}` !== key) continue;
    byRange.set(key, {
      rangeKey: key,
      inputSnapshot: input,
      resultSnapshot: result,
    });
  }
  return [...byRange.values()].sort((left, right) =>
    left.rangeKey.localeCompare(right.rangeKey),
  );
}

async function storeRecoveryOperations(
  request: RecoveryRequest,
  reused: ReusableChunk[],
) {
  const { baseUrl, secret } = supabaseConnection();
  const operations = [
    {
      operation_type: SALES_EVENT_REQUEST,
      status: "SUCCEEDED",
      source: "ops-center-canonical-sales-events-recovery",
      source_event_id: `sales-event-recovery-request:${request.requestId}`,
      correlation_id: requestCorrelationId(request.requestId),
      actor_type: "OPS_WORKER",
      input_snapshot: request,
      result_snapshot: {
        accepted: true,
        state: "QUEUED",
        recovery: true,
        chunkDays: request.chunkDays,
        supersedesRequestId: request.supersedesRequestId,
        reusedChunkCount: reused.length,
        message: `${request.chunkDays}일 Shopling 주문 조회구간으로 안전 재접수했습니다.`,
      },
      error_message: null,
      started_at: request.createdAt,
      finished_at: request.createdAt,
      updated_at: request.createdAt,
    },
    ...reused.map((chunk) => ({
      operation_type: SALES_EVENT_CHUNK,
      status: "SUCCEEDED",
      source: "ops-center-canonical-sales-events-recovery-reuse",
      source_event_id: `sales-event-recovery-chunk:${request.requestId}:${chunk.rangeKey}`,
      correlation_id: requestCorrelationId(request.requestId),
      actor_type: "OPS_WORKER",
      input_snapshot: {
        ...chunk.inputSnapshot,
        requestId: request.requestId,
        planningContentFingerprint: request.planningContentFingerprint,
        reusedFromRequestId: request.supersedesRequestId,
      },
      result_snapshot: chunk.resultSnapshot,
      error_message: null,
      started_at: request.createdAt,
      finished_at: request.createdAt,
      updated_at: request.createdAt,
    })),
  ];
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=id,source_event_id,started_at`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify(operations),
      cache: "no-store",
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `SALES_EVENT_RECOVERY_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
}

async function copyMissingReusableChunksToLatest() {
  const requests = await latestRequests();
  const latest = requests[0];
  if (!latest?.supersedesRequestId) {
    return { reusedChunks: 0, requestId: latest?.requestId ?? null };
  }
  const requestsById = new Map(requests.map((request) => [request.requestId, request]));
  const parent = requestsById.get(latest.supersedesRequestId);
  const reusable = await reusableParentChunks(latest, parent);
  if (!reusable.length) return { reusedChunks: 0, requestId: latest.requestId };

  const currentRows = await readOperations(
    SALES_EVENT_CHUNK,
    OPERATION_LIMIT,
  );
  const currentCorrelation = requestCorrelationId(latest.requestId);
  const completed = new Set(
    currentRows
      .filter((row) => text(row.correlation_id) === currentCorrelation)
      .map(operationRangeKey),
  );
  const missing = reusable.filter((chunk) => !completed.has(chunk.rangeKey));
  if (!missing.length) return { reusedChunks: 0, requestId: latest.requestId };

  const recoveryRequest: RecoveryRequest = {
    ...latest,
    ranges: splitShoplingDateRange(
      latest.analysisStartDate,
      latest.analysisEndDate,
      latest.chunkDays,
    ),
  };
  const { baseUrl, secret } = supabaseConnection();
  const now = new Date().toISOString();
  const rows = missing.map((chunk) => ({
    operation_type: SALES_EVENT_CHUNK,
    status: "SUCCEEDED",
    source: "ops-center-canonical-sales-events-recovery-reuse",
    source_event_id: `sales-event-recovery-chunk:${latest.requestId}:${chunk.rangeKey}`,
    correlation_id: currentCorrelation,
    actor_type: "OPS_WORKER",
    input_snapshot: {
      ...chunk.inputSnapshot,
      requestId: latest.requestId,
      planningContentFingerprint: latest.planningContentFingerprint,
      reusedFromRequestId: latest.supersedesRequestId,
    },
    result_snapshot: chunk.resultSnapshot,
    error_message: null,
    started_at: now,
    finished_at: now,
    updated_at: now,
  }));
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=id,source_event_id,started_at`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify(rows),
      cache: "no-store",
    },
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `SALES_EVENT_REUSE_STORE_FAILED:${response.status}:${body.slice(0, 300)}`,
    );
  }
  void recoveryRequest;
  return {
    reusedChunks: missing.length,
    requestId: latest.requestId,
    reusedFromRequestId: latest.supersedesRequestId,
  };
}

export async function hydrateProductMasterShoplingSalesEventRecovery() {
  return copyMissingReusableChunksToLatest();
}

export async function recoverProductMasterShoplingSalesEventRequest() {
  const requests = await latestRequests();
  const latest = requests[0];
  if (!latest) return { recovered: false as const, reason: "NO_REQUEST" as const };
  if (!(await hasTerminalFailure(latest.requestId))) {
    return { recovered: false as const, reason: "LATEST_NOT_FAILED" as const };
  }

  const requestsById = new Map(requests.map((request) => [request.requestId, request]));
  const attemptsInTier = tierAttemptCount(latest, requestsById);
  let chunkDays = latest.chunkDays;
  let reason: "RETRY_SAME_TIER" | "SHRINK_RANGE" = "RETRY_SAME_TIER";
  if (attemptsInTier >= SALES_EVENT_MAX_REQUEST_ATTEMPTS_PER_TIER) {
    const smaller = nextChunkDays(latest.chunkDays);
    if (smaller === null) {
      return {
        recovered: false as const,
        reason: "MINIMUM_RANGE_EXHAUSTED" as const,
        requestId: latest.requestId,
        chunkDays: latest.chunkDays,
        attemptsInTier,
      };
    }
    chunkDays = smaller;
    reason = "SHRINK_RANGE";
  }

  const planning = await loadProductPlanningSnapshot();
  const createdAt = new Date().toISOString();
  const request: RecoveryRequest = {
    requestId: crypto.randomUUID(),
    analysisAsOf: latest.analysisAsOf,
    analysisStartDate: latest.analysisStartDate,
    analysisEndDate: latest.analysisEndDate,
    planningGeneratedAt: planning.generatedAt,
    planningContentFingerprint: planning.contentFingerprint,
    chunkDays,
    supersedesRequestId: latest.requestId,
    ranges: splitShoplingDateRange(
      latest.analysisStartDate,
      latest.analysisEndDate,
      chunkDays,
    ),
    createdAt,
  };
  const reusable = await reusableParentChunks(request, latest);
  await storeRecoveryOperations(request, reusable);
  return {
    recovered: true as const,
    reason,
    requestId: request.requestId,
    supersedesRequestId: latest.requestId,
    analysisAsOf: request.analysisAsOf,
    chunkDays,
    reusedChunks: reusable.length,
    attemptsInPreviousTier: attemptsInTier,
    totalRanges: request.ranges.length,
  };
}

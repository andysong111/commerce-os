import { createHash, randomUUID } from "node:crypto";
import { CHINA_ORDER_EVENT_OPERATION_TYPE } from "@/lib/chinaOrderLedger";
import { loadStage8CanonicalSalesEventSnapshot } from "@/lib/stage8CanonicalSalesEventSnapshot";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const INVENTORY_STOCKOUT_RESET_OPERATION_TYPE =
  "INVENTORY_STOCKOUT_RESET_EVENT";
export const SHOPLING_INVENTORY_SYNC_OPERATION_TYPE =
  "SHOPLING_INVENTORY_STATUS_SYNC_EVENT";

export type ShoplingInventoryProductMode = "OPTION" | "SINGLE";
export type ShoplingInventoryDesiredStatus = "SOLD_OUT" | "SELLING";
export type ShoplingInventorySyncState =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED";

export type InventoryStockoutResetInput = {
  barcode: string;
  modelNo?: string | null;
  productName?: string | null;
  productMode: ShoplingInventoryProductMode;
  reason?: string;
  occurredAt?: string;
  sourceEventId?: string;
};

export type ShoplingInventorySyncEventInput = {
  jobId: string;
  barcode: string;
  modelNo?: string | null;
  productName?: string | null;
  productMode: ShoplingInventoryProductMode;
  desiredStatus: ShoplingInventoryDesiredStatus;
  state: ShoplingInventorySyncState;
  stage?: string;
  message?: string;
  errorCode?: string | null;
  occurredAt?: string;
  sourceEventId?: string;
};

export type InventoryStockoutInterval = {
  startAt: string;
  endAt: string;
};

export type InventoryLifecycleRow = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  productMode: ShoplingInventoryProductMode;
  resetAt: string;
  exactInventoryKnown: boolean;
  exactInventoryQuantity: number | null;
  inboundAfterReset: number;
  salesAfterReset: number;
  availableDaysByBucket: number[];
  stockoutIntervals: InventoryStockoutInterval[];
  latestSuccessfulShoplingStatus: ShoplingInventoryDesiredStatus | null;
  latestShoplingSyncState: ShoplingInventorySyncState | null;
  latestShoplingSyncStage: string | null;
  latestShoplingSyncAt: string | null;
  nextRecommendedSync: ShoplingInventoryDesiredStatus | null;
  pendingJobId: string | null;
  reason: string;
};

export type InventoryLifecycleSnapshot = {
  generatedAt: string;
  state: "READY" | "BLOCKED";
  message: string;
  salesCoverageStartAt: string | null;
  salesCoverageEndAt: string | null;
  rows: InventoryLifecycleRow[];
  blockers: string[];
  fingerprint: string;
};

type StoredOperationRow = {
  operation_type?: unknown;
  source_event_id?: unknown;
  input_snapshot?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
};

type ResetEvent = {
  barcode: string;
  modelNo: string | null;
  productName: string;
  productMode: ShoplingInventoryProductMode;
  reason: string;
  occurredAt: string;
  sourceEventId: string;
};

type SyncEvent = ShoplingInventorySyncEventInput & {
  occurredAt: string;
  sourceEventId: string;
};

type ReceiptDelta = {
  barcode: string;
  occurredAt: string;
  quantity: number;
  sourceLineId: string;
};

type TimelineEvent = {
  occurredAt: string;
  kind: "RECEIPT" | "SALE";
  quantity: number;
};

const BARCODE_PATTERN = /^[A-Z]{3}\d+-\d+$/;
const READ_LIMIT = 10_000;
const BUCKET_DAYS = 30;
const BUCKET_COUNT = 12;
const DAY_MS = 86_400_000;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeBarcode(value: unknown) {
  return text(value)
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function validIso(value: unknown, fallback?: string) {
  const parsed = Date.parse(text(value));
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  if (fallback) return fallback;
  return null;
}

function normalizeProductMode(value: unknown): ShoplingInventoryProductMode {
  return text(value).toUpperCase() === "SINGLE" ? "SINGLE" : "OPTION";
}

function normalizeDesiredStatus(
  value: unknown,
): ShoplingInventoryDesiredStatus | null {
  const normalized = text(value).toUpperCase();
  return normalized === "SOLD_OUT" || normalized === "SELLING"
    ? normalized
    : null;
}

function normalizeSyncState(value: unknown): ShoplingInventorySyncState | null {
  const normalized = text(value).toUpperCase();
  return ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"].includes(normalized)
    ? (normalized as ShoplingInventorySyncState)
    : null;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function operationSourceEventId(prefix: string, supplied?: string) {
  const candidate = text(supplied);
  return candidate || `${prefix}:${randomUUID()}`;
}

async function insertImmutableOperation(input: {
  operationType: string;
  sourceEventId: string;
  correlationId: string;
  occurredAt: string;
  snapshot: unknown;
  result?: unknown;
}) {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const row = {
    operation_type: input.operationType,
    status: "SUCCEEDED",
    source: "COMMERCE_OS_INVENTORY_LIFECYCLE",
    source_event_id: input.sourceEventId,
    correlation_id: input.correlationId,
    actor_type: "OPS_OPERATOR",
    input_snapshot: input.snapshot,
    result_snapshot: input.result ?? { accepted: true },
    error_message: null,
    started_at: input.occurredAt,
    finished_at: input.occurredAt,
    updated_at: input.occurredAt,
  };
  const result = await admin
    .from("commerce_operation_runs")
    .upsert(row, {
      onConflict: "source_event_id",
      ignoreDuplicates: true,
    })
    .select("id,source_event_id")
    .limit(1);
  if (result.error) {
    throw new Error(`INVENTORY_LIFECYCLE_STORE_FAILED:${result.error.message}`);
  }
  return {
    duplicate: !Array.isArray(result.data) || result.data.length === 0,
    sourceEventId: input.sourceEventId,
  };
}

export function normalizeStockoutResetInput(
  input: InventoryStockoutResetInput,
  now = new Date(),
): ResetEvent {
  const barcode = normalizeBarcode(input.barcode);
  if (!BARCODE_PATTERN.test(barcode)) {
    throw new Error(`INVENTORY_STOCKOUT_BARCODE_INVALID:${barcode}`);
  }
  const occurredAt = validIso(input.occurredAt, now.toISOString());
  if (!occurredAt) throw new Error("INVENTORY_STOCKOUT_OCCURRED_AT_INVALID");
  return {
    barcode,
    modelNo: text(input.modelNo) || null,
    productName: text(input.productName) || barcode,
    productMode: normalizeProductMode(input.productMode),
    reason: text(input.reason).slice(0, 500),
    occurredAt,
    sourceEventId: operationSourceEventId(
      `inventory-stockout-reset:${barcode}`,
      input.sourceEventId,
    ),
  };
}

export async function recordInventoryStockoutReset(
  input: InventoryStockoutResetInput,
) {
  const event = normalizeStockoutResetInput(input);
  const stored = await insertImmutableOperation({
    operationType: INVENTORY_STOCKOUT_RESET_OPERATION_TYPE,
    sourceEventId: event.sourceEventId,
    correlationId: `inventory-lifecycle:${event.barcode}`,
    occurredAt: event.occurredAt,
    snapshot: event,
    result: {
      accepted: true,
      barcode: event.barcode,
      inventoryBaseline: 0,
      productMode: event.productMode,
    },
  });
  return { ...stored, event };
}

export function normalizeShoplingInventorySyncEvent(
  input: ShoplingInventorySyncEventInput,
  now = new Date(),
): SyncEvent {
  const barcode = normalizeBarcode(input.barcode);
  if (!BARCODE_PATTERN.test(barcode)) {
    throw new Error(`SHOPLING_INVENTORY_SYNC_BARCODE_INVALID:${barcode}`);
  }
  const desiredStatus = normalizeDesiredStatus(input.desiredStatus);
  const state = normalizeSyncState(input.state);
  if (!desiredStatus || !state) {
    throw new Error("SHOPLING_INVENTORY_SYNC_STATE_INVALID");
  }
  const jobId = text(input.jobId);
  if (!jobId) throw new Error("SHOPLING_INVENTORY_SYNC_JOB_REQUIRED");
  const occurredAt = validIso(input.occurredAt, now.toISOString());
  if (!occurredAt) throw new Error("SHOPLING_INVENTORY_SYNC_AT_INVALID");
  return {
    ...input,
    jobId,
    barcode,
    modelNo: text(input.modelNo) || null,
    productName: text(input.productName) || barcode,
    productMode: normalizeProductMode(input.productMode),
    desiredStatus,
    state,
    stage: text(input.stage).slice(0, 100),
    message: text(input.message).slice(0, 500),
    errorCode: text(input.errorCode) || null,
    occurredAt,
    sourceEventId: operationSourceEventId(
      `shopling-inventory-sync:${jobId}:${state}:${text(input.stage) || "stage"}`,
      input.sourceEventId,
    ),
  };
}

export async function recordShoplingInventorySyncEvent(
  input: ShoplingInventorySyncEventInput,
) {
  const event = normalizeShoplingInventorySyncEvent(input);
  const stored = await insertImmutableOperation({
    operationType: SHOPLING_INVENTORY_SYNC_OPERATION_TYPE,
    sourceEventId: event.sourceEventId,
    correlationId: `shopling-inventory-sync:${event.jobId}`,
    occurredAt: event.occurredAt,
    snapshot: event,
    result: {
      accepted: true,
      jobId: event.jobId,
      barcode: event.barcode,
      desiredStatus: event.desiredStatus,
      state: event.state,
      stage: event.stage,
    },
  });
  return { ...stored, event };
}

export async function createPendingShoplingInventorySync(input: {
  barcode: string;
  modelNo?: string | null;
  productName?: string | null;
  productMode: ShoplingInventoryProductMode;
  desiredStatus: ShoplingInventoryDesiredStatus;
  message?: string;
}) {
  const jobId = `shopling-inventory:${normalizeBarcode(input.barcode)}:${Date.now()}:${randomUUID().slice(0, 8)}`;
  const result = await recordShoplingInventorySyncEvent({
    ...input,
    jobId,
    state: "PENDING",
    stage: "QUEUED",
    message:
      text(input.message) ||
      `${input.desiredStatus === "SOLD_OUT" ? "품절" : "판매중"} Shopling 반영 대기`,
  });
  return { jobId, event: result.event, duplicate: result.duplicate };
}

function parseReset(row: StoredOperationRow): ResetEvent | null {
  const snapshot = object(row.input_snapshot);
  const barcode = normalizeBarcode(snapshot.barcode);
  const occurredAt = validIso(snapshot.occurredAt || row.started_at);
  if (!BARCODE_PATTERN.test(barcode) || !occurredAt) return null;
  return {
    barcode,
    modelNo: text(snapshot.modelNo) || null,
    productName: text(snapshot.productName) || barcode,
    productMode: normalizeProductMode(snapshot.productMode),
    reason: text(snapshot.reason),
    occurredAt,
    sourceEventId: text(snapshot.sourceEventId || row.source_event_id),
  };
}

function parseSync(row: StoredOperationRow): SyncEvent | null {
  const snapshot = object(row.input_snapshot);
  const desiredStatus = normalizeDesiredStatus(snapshot.desiredStatus);
  const state = normalizeSyncState(snapshot.state);
  const barcode = normalizeBarcode(snapshot.barcode);
  const occurredAt = validIso(snapshot.occurredAt || row.started_at);
  const jobId = text(snapshot.jobId);
  if (
    !desiredStatus ||
    !state ||
    !BARCODE_PATTERN.test(barcode) ||
    !occurredAt ||
    !jobId
  ) {
    return null;
  }
  return {
    jobId,
    barcode,
    modelNo: text(snapshot.modelNo) || null,
    productName: text(snapshot.productName) || barcode,
    productMode: normalizeProductMode(snapshot.productMode),
    desiredStatus,
    state,
    stage: text(snapshot.stage),
    message: text(snapshot.message),
    errorCode: text(snapshot.errorCode) || null,
    occurredAt,
    sourceEventId: text(snapshot.sourceEventId || row.source_event_id),
  };
}

function parseChinaEvent(row: StoredOperationRow) {
  const snapshot = object(row.input_snapshot);
  const barcode = normalizeBarcode(snapshot.barcode);
  const sourceSystem = text(snapshot.sourceSystem);
  const sourceLineId = text(snapshot.sourceLineId);
  const occurredAt = validIso(snapshot.occurredAt || row.started_at);
  const status = text(snapshot.status).toUpperCase();
  if (
    !BARCODE_PATTERN.test(barcode) ||
    !sourceSystem ||
    !sourceLineId ||
    !occurredAt
  ) {
    return null;
  }
  return {
    barcode,
    sourceSystem,
    sourceLineId,
    occurredAt,
    status,
    requestedQuantity:
      snapshot.requestedQuantity === null || snapshot.requestedQuantity === undefined
        ? null
        : quantity(snapshot.requestedQuantity),
    orderedQuantity:
      snapshot.orderedQuantity === null || snapshot.orderedQuantity === undefined
        ? null
        : quantity(snapshot.orderedQuantity),
    receivedQuantity:
      snapshot.receivedQuantity === null || snapshot.receivedQuantity === undefined
        ? null
        : quantity(snapshot.receivedQuantity),
    cancelledQuantity:
      snapshot.cancelledQuantity === null || snapshot.cancelledQuantity === undefined
        ? null
        : quantity(snapshot.cancelledQuantity),
  };
}

function receiptDeltas(rows: StoredOperationRow[]) {
  const grouped = new Map<string, ReturnType<typeof parseChinaEvent>[] & unknown[]>();
  for (const row of rows) {
    const event = parseChinaEvent(row);
    if (!event) continue;
    const key = `${event.sourceSystem}\u0000${event.sourceLineId}\u0000${event.barcode}`;
    const current = (grouped.get(key) ?? []) as NonNullable<
      ReturnType<typeof parseChinaEvent>
    >[];
    current.push(event);
    grouped.set(key, current as never);
  }

  const deltas: ReceiptDelta[] = [];
  for (const rawEvents of grouped.values()) {
    const events = (rawEvents as NonNullable<
      ReturnType<typeof parseChinaEvent>
    >[]).sort(
      (left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
    );
    let requested = 0;
    let ordered = 0;
    let received = 0;
    let cancelled = 0;
    for (const event of events) {
      requested = Math.max(requested, event.requestedQuantity ?? requested);
      ordered = Math.max(ordered, event.orderedQuantity ?? ordered);
      const committed = Math.max(requested, ordered);
      if (event.cancelledQuantity !== null) {
        cancelled = Math.max(cancelled, event.cancelledQuantity);
      }
      let nextReceived = received;
      if (event.receivedQuantity !== null) {
        nextReceived = Math.max(nextReceived, event.receivedQuantity);
      }
      if (event.status === "RECEIVED" && event.receivedQuantity === null) {
        nextReceived = Math.max(nextReceived, committed - cancelled);
      }
      nextReceived = Math.min(committed, nextReceived);
      const delta = Math.max(0, nextReceived - received);
      if (delta > 0) {
        deltas.push({
          barcode: event.barcode,
          occurredAt: event.occurredAt,
          quantity: delta,
          sourceLineId: `${event.sourceSystem}:${event.sourceLineId}`,
        });
      }
      received = nextReceived;
    }
  }
  return deltas;
}

function overlapMs(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
) {
  return Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
}

function availabilityByBucket(
  intervals: InventoryStockoutInterval[],
  analysisAsOf: string,
) {
  const end = Date.parse(analysisAsOf);
  return Array.from({ length: BUCKET_COUNT }, (_, index) => {
    const bucketEnd = end - index * BUCKET_DAYS * DAY_MS;
    const bucketStart = bucketEnd - BUCKET_DAYS * DAY_MS;
    const unavailableMs = intervals.reduce(
      (total, interval) =>
        total +
        overlapMs(
          bucketStart,
          bucketEnd,
          Date.parse(interval.startAt),
          Date.parse(interval.endAt),
        ),
      0,
    );
    return Math.round(
      Math.max(0, BUCKET_DAYS - unavailableMs / DAY_MS) * 10,
    ) / 10;
  });
}

function buildExactInventory(input: {
  reset: ResetEvent;
  receipts: ReceiptDelta[];
  sales: Array<{ occurredAt: string; quantity: number }>;
  analysisAsOf: string;
}) {
  const resetMs = Date.parse(input.reset.occurredAt);
  const endMs = Date.parse(input.analysisAsOf);
  const timeline: TimelineEvent[] = [
    ...input.receipts
      .filter(
        (event) =>
          event.barcode === input.reset.barcode &&
          Date.parse(event.occurredAt) >= resetMs &&
          Date.parse(event.occurredAt) <= endMs,
      )
      .map((event) => ({
        occurredAt: event.occurredAt,
        kind: "RECEIPT" as const,
        quantity: event.quantity,
      })),
    ...input.sales
      .filter(
        (event) =>
          Date.parse(event.occurredAt) >= resetMs &&
          Date.parse(event.occurredAt) <= endMs,
      )
      .map((event) => ({
        occurredAt: event.occurredAt,
        kind: "SALE" as const,
        quantity: event.quantity,
      })),
  ].sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      Number(left.kind === "SALE") - Number(right.kind === "SALE"),
  );

  let currentQuantity = 0;
  let inboundAfterReset = 0;
  let salesAfterReset = 0;
  let intervalStart: string | null = input.reset.occurredAt;
  const stockoutIntervals: InventoryStockoutInterval[] = [];

  for (const event of timeline) {
    const wasStockout = currentQuantity <= 0;
    if (event.kind === "RECEIPT") {
      inboundAfterReset += event.quantity;
      currentQuantity += event.quantity;
    } else {
      salesAfterReset += event.quantity;
      currentQuantity = Math.max(0, currentQuantity - event.quantity);
    }
    const isStockout = currentQuantity <= 0;
    if (wasStockout && !isStockout && intervalStart) {
      stockoutIntervals.push({
        startAt: intervalStart,
        endAt: event.occurredAt,
      });
      intervalStart = null;
    } else if (!wasStockout && isStockout) {
      intervalStart = event.occurredAt;
    }
  }
  if (currentQuantity <= 0 && intervalStart) {
    stockoutIntervals.push({
      startAt: intervalStart,
      endAt: input.analysisAsOf,
    });
  }

  return {
    currentQuantity,
    inboundAfterReset,
    salesAfterReset,
    stockoutIntervals,
    availableDaysByBucket: availabilityByBucket(
      stockoutIntervals,
      input.analysisAsOf,
    ),
  };
}

async function readLifecycleRows() {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const result = await admin
    .from("commerce_operation_runs")
    .select(
      "operation_type,source_event_id,input_snapshot,started_at,updated_at",
    )
    .in("operation_type", [
      INVENTORY_STOCKOUT_RESET_OPERATION_TYPE,
      SHOPLING_INVENTORY_SYNC_OPERATION_TYPE,
      CHINA_ORDER_EVENT_OPERATION_TYPE,
    ])
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: true })
    .limit(READ_LIMIT);
  if (result.error) {
    throw new Error(`INVENTORY_LIFECYCLE_READ_FAILED:${result.error.message}`);
  }
  return (Array.isArray(result.data) ? result.data : []) as StoredOperationRow[];
}

export async function loadInventoryLifecycleSnapshot(): Promise<InventoryLifecycleSnapshot> {
  const generatedAt = new Date().toISOString();
  const blockers: string[] = [];
  try {
    const [storedRows, salesSnapshot] = await Promise.all([
      readLifecycleRows(),
      loadStage8CanonicalSalesEventSnapshot(),
    ]);
    if (salesSnapshot.state !== "READY_READ_ONLY") {
      blockers.push("Canonical 판매 이벤트가 준비되지 않아 품절 초기화 이후 정확재고를 계산할 수 없습니다.");
    }
    const resetEvents = storedRows
      .filter(
        (row) =>
          text(row.operation_type) === INVENTORY_STOCKOUT_RESET_OPERATION_TYPE,
      )
      .map(parseReset)
      .filter((row): row is ResetEvent => Boolean(row));
    const latestResetByBarcode = new Map<string, ResetEvent>();
    for (const reset of resetEvents) {
      const current = latestResetByBarcode.get(reset.barcode);
      if (!current || Date.parse(reset.occurredAt) > Date.parse(current.occurredAt)) {
        latestResetByBarcode.set(reset.barcode, reset);
      }
    }
    const syncEvents = storedRows
      .filter(
        (row) =>
          text(row.operation_type) === SHOPLING_INVENTORY_SYNC_OPERATION_TYPE,
      )
      .map(parseSync)
      .filter((row): row is SyncEvent => Boolean(row));
    const receipts = receiptDeltas(
      storedRows.filter(
        (row) => text(row.operation_type) === CHINA_ORDER_EVENT_OPERATION_TYPE,
      ),
    );
    const analysisAsOf =
      salesSnapshot.analysisAsOf ||
      salesSnapshot.coverageEndAt ||
      generatedAt;
    const coverageStartMs = salesSnapshot.coverageStartAt
      ? Date.parse(salesSnapshot.coverageStartAt)
      : Number.NaN;

    const rows: InventoryLifecycleRow[] = [];
    for (const reset of latestResetByBarcode.values()) {
      const resetMs = Date.parse(reset.occurredAt);
      const exactInventoryKnown =
        salesSnapshot.state === "READY_READ_ONLY" &&
        Number.isFinite(coverageStartMs) &&
        resetMs >= coverageStartMs;
      const sales = salesSnapshot.events
        .filter(
          (event) =>
            event.validSale &&
            normalizeBarcode(event.barcode) === reset.barcode,
        )
        .map((event) => ({
          occurredAt: event.occurredAt,
          quantity: quantity(event.quantity),
        }));
      const exact = buildExactInventory({
        reset,
        receipts,
        sales,
        analysisAsOf,
      });
      const relatedSync = syncEvents
        .filter(
          (event) =>
            event.barcode === reset.barcode &&
            Date.parse(event.occurredAt) >= resetMs,
        )
        .sort(
          (left, right) =>
            Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
        );
      const latestSync = relatedSync.at(-1) ?? null;
      const successfulSync = [...relatedSync]
        .reverse()
        .find((event) => event.state === "SUCCEEDED") ?? null;
      const latestPending = [...relatedSync]
        .reverse()
        .find(
          (event) =>
            event.state === "PENDING" || event.state === "RUNNING",
        ) ?? null;
      let nextRecommendedSync: ShoplingInventoryDesiredStatus | null = null;
      if (!latestPending) {
        if (
          exactInventoryKnown &&
          exact.currentQuantity > 0 &&
          successfulSync?.desiredStatus !== "SELLING"
        ) {
          nextRecommendedSync = "SELLING";
        } else if (
          exactInventoryKnown &&
          exact.currentQuantity <= 0 &&
          successfulSync?.desiredStatus !== "SOLD_OUT"
        ) {
          nextRecommendedSync = "SOLD_OUT";
        }
      }
      rows.push({
        barcode: reset.barcode,
        modelNo: reset.modelNo,
        productName: reset.productName,
        productMode: reset.productMode,
        resetAt: reset.occurredAt,
        exactInventoryKnown,
        exactInventoryQuantity: exactInventoryKnown
          ? exact.currentQuantity
          : null,
        inboundAfterReset: exact.inboundAfterReset,
        salesAfterReset: exact.salesAfterReset,
        availableDaysByBucket: exact.availableDaysByBucket,
        stockoutIntervals: exact.stockoutIntervals,
        latestSuccessfulShoplingStatus:
          successfulSync?.desiredStatus ?? null,
        latestShoplingSyncState: latestSync?.state ?? null,
        latestShoplingSyncStage: latestSync?.stage || null,
        latestShoplingSyncAt: latestSync?.occurredAt ?? null,
        nextRecommendedSync,
        pendingJobId: latestPending?.jobId ?? null,
        reason: reset.reason,
      });
    }
    rows.sort(
      (left, right) =>
        Number(Boolean(right.nextRecommendedSync)) -
          Number(Boolean(left.nextRecommendedSync)) ||
        Date.parse(right.resetAt) - Date.parse(left.resetAt) ||
        left.barcode.localeCompare(right.barcode, "ko"),
    );
    const stable = rows.map((row) => ({
      barcode: row.barcode,
      resetAt: row.resetAt,
      exactInventoryKnown: row.exactInventoryKnown,
      exactInventoryQuantity: row.exactInventoryQuantity,
      inboundAfterReset: row.inboundAfterReset,
      salesAfterReset: row.salesAfterReset,
      latestSuccessfulShoplingStatus: row.latestSuccessfulShoplingStatus,
      latestShoplingSyncState: row.latestShoplingSyncState,
      nextRecommendedSync: row.nextRecommendedSync,
    }));
    return {
      generatedAt,
      state: blockers.length ? "BLOCKED" : "READY",
      message: blockers.length
        ? "품절 초기화 원장은 읽었지만 정확재고 계산을 막는 입력이 남아 있습니다."
        : "품절 초기화 이후 확정입고 증가분과 유효판매를 결합해 정확재고를 계산했습니다.",
      salesCoverageStartAt: salesSnapshot.coverageStartAt,
      salesCoverageEndAt: salesSnapshot.coverageEndAt,
      rows,
      blockers,
      fingerprint: sha256({
        salesFingerprint: salesSnapshot.fingerprint,
        rows: stable,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      generatedAt,
      state: "BLOCKED",
      message: "품절 초기화·입고·판매 원장을 읽지 못했습니다.",
      salesCoverageStartAt: null,
      salesCoverageEndAt: null,
      rows: [],
      blockers: [message],
      fingerprint: sha256({ state: "BLOCKED", message }),
    };
  }
}

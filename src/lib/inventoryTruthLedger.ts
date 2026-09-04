import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadProductPlanningSnapshot } from "@/lib/productDecisionLiveRefresh";
import { loadStage8CanonicalSalesEventSnapshot } from "@/lib/stage8CanonicalSalesEventSnapshot";

export const INVENTORY_TRUTH_OPERATION_TYPE = "INVENTORY_TRUTH_EVENT";

const BARCODE_PATTERN = /^[A-Z]{3}\d+-\d+$/;
const READ_LIMIT = 5000;
const DAY_MS = 86_400_000;

export type ShoplingProductKind = "OPTION" | "SINGLE";
export type ShoplingSaleState = "SOLD_OUT" | "ON_SALE";
export type InventoryTruthAction =
  | "STOCKOUT_RESET"
  | "RECEIPT_CONFIRMED"
  | "SHOPLING_STATE_TARGET"
  | "SHOPLING_SYNC_RESULT";

export type InventoryTruthEventInput = {
  sourceEventId: string;
  barcode: string;
  action: InventoryTruthAction;
  occurredAt?: string;
  quantity?: number;
  targetState?: ShoplingSaleState;
  productKind?: ShoplingProductKind;
  modelNo?: string | null;
  taskId?: string | null;
  success?: boolean | null;
  message?: string;
  payload?: unknown;
};

export type InventoryTruthEvent = {
  sourceEventId: string;
  barcode: string;
  action: InventoryTruthAction;
  occurredAt: string;
  quantity: number;
  targetState: ShoplingSaleState | null;
  productKind: ShoplingProductKind | null;
  modelNo: string | null;
  taskId: string | null;
  success: boolean | null;
  message: string;
  payload: unknown;
};

export type ShoplingStockStateTask = {
  taskId: string;
  barcode: string;
  modelNo: string | null;
  productKind: ShoplingProductKind;
  targetState: ShoplingSaleState;
  requestedAt: string;
  reason: "STOCKOUT_RESET" | "RECEIPT_RESTORE" | "MANUAL";
};

export type InventoryTruthPosition = {
  barcode: string;
  exact: boolean;
  exactSince: string | null;
  quantity: number | null;
  receivedAfterReset: number;
  soldAfterReset: number;
  targetState: ShoplingSaleState | null;
  shoplingSyncedState: ShoplingSaleState | null;
  productKind: ShoplingProductKind | null;
  modelNo: string | null;
  stockoutDays: number[];
  pendingTask: ShoplingStockStateTask | null;
};

export type InventoryTruthSnapshot = {
  generatedAt: string;
  analysisAsOf: string;
  positions: InventoryTruthPosition[];
  byBarcode: Map<string, InventoryTruthPosition>;
  pendingTasks: ShoplingStockStateTask[];
  fingerprint: string;
  error: string | null;
};

type StoredRow = {
  source_event_id?: unknown;
  input_snapshot?: unknown;
  started_at?: unknown;
};

type CanonicalSaleEvent = {
  barcode?: unknown;
  occurredAt?: unknown;
  quantity?: unknown;
  validSale?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function barcode(value: unknown) {
  return text(value)
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/\s+/g, "");
}

function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function validIso(value: unknown, fallback = new Date()) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback.toISOString();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validAction(value: unknown): value is InventoryTruthAction {
  return [
    "STOCKOUT_RESET",
    "RECEIPT_CONFIRMED",
    "SHOPLING_STATE_TARGET",
    "SHOPLING_SYNC_RESULT",
  ].includes(String(value));
}

function validTargetState(value: unknown): value is ShoplingSaleState {
  return value === "SOLD_OUT" || value === "ON_SALE";
}

function validProductKind(value: unknown): value is ShoplingProductKind {
  return value === "OPTION" || value === "SINGLE";
}

export function normalizeInventoryTruthEvent(
  input: InventoryTruthEventInput,
): InventoryTruthEvent {
  const normalizedBarcode = barcode(input.barcode);
  if (!BARCODE_PATTERN.test(normalizedBarcode)) {
    throw new Error(`INVENTORY_TRUTH_BARCODE_INVALID:${normalizedBarcode}`);
  }
  const sourceEventId = text(input.sourceEventId);
  if (!sourceEventId) throw new Error("INVENTORY_TRUTH_SOURCE_EVENT_REQUIRED");
  if (!validAction(input.action)) {
    throw new Error("INVENTORY_TRUTH_ACTION_INVALID");
  }
  const targetState = validTargetState(input.targetState)
    ? input.targetState
    : null;
  const productKind = validProductKind(input.productKind)
    ? input.productKind
    : null;
  const success =
    typeof input.success === "boolean" ? input.success : null;
  if (input.action === "RECEIPT_CONFIRMED" && integer(input.quantity) <= 0) {
    throw new Error("INVENTORY_TRUTH_RECEIPT_QUANTITY_INVALID");
  }
  if (
    input.action === "SHOPLING_STATE_TARGET" &&
    (!targetState || !productKind)
  ) {
    throw new Error("INVENTORY_TRUTH_SHOPLING_TARGET_INCOMPLETE");
  }
  if (
    input.action === "SHOPLING_SYNC_RESULT" &&
    (!text(input.taskId) || success === null)
  ) {
    throw new Error("INVENTORY_TRUTH_SYNC_RESULT_INCOMPLETE");
  }
  return {
    sourceEventId,
    barcode: normalizedBarcode,
    action: input.action,
    occurredAt: validIso(input.occurredAt),
    quantity: integer(input.quantity),
    targetState,
    productKind,
    modelNo: text(input.modelNo) || null,
    taskId: text(input.taskId) || null,
    success,
    message: text(input.message).slice(0, 500),
    payload: input.payload ?? null,
  };
}

export async function appendInventoryTruthEvent(
  input: InventoryTruthEventInput,
) {
  const event = normalizeInventoryTruthEvent(input);
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  const sourceEventId = `inventory-truth:${event.sourceEventId}`;
  const result = await admin
    .from("commerce_operation_runs")
    .upsert(
      [
        {
          operation_type: INVENTORY_TRUTH_OPERATION_TYPE,
          status: "SUCCEEDED",
          source: "COMMERCE_OS_INVENTORY_TRUTH",
          source_event_id: sourceEventId,
          correlation_id: `inventory-truth:${event.barcode}`,
          actor_type: "OPS_OPERATOR",
          input_snapshot: event,
          result_snapshot: {
            accepted: true,
            barcode: event.barcode,
            action: event.action,
            taskId: event.taskId,
          },
          error_message: null,
          started_at: event.occurredAt,
          finished_at: event.occurredAt,
          updated_at: event.occurredAt,
        },
      ],
      { onConflict: "source_event_id", ignoreDuplicates: true },
    )
    .select("id,source_event_id");
  if (result.error) {
    throw new Error(`INVENTORY_TRUTH_STORE_FAILED:${result.error.message}`);
  }
  return {
    event,
    sourceEventId,
    duplicate: !Array.isArray(result.data) || result.data.length === 0,
  };
}

function eventFromStoredRow(row: StoredRow): InventoryTruthEvent | null {
  const snapshot = object(row.input_snapshot);
  try {
    return normalizeInventoryTruthEvent({
      sourceEventId:
        text(snapshot.sourceEventId) || text(row.source_event_id),
      barcode: snapshot.barcode as string,
      action: snapshot.action as InventoryTruthAction,
      occurredAt: text(snapshot.occurredAt) || text(row.started_at),
      quantity: snapshot.quantity as number,
      targetState: snapshot.targetState as ShoplingSaleState,
      productKind: snapshot.productKind as ShoplingProductKind,
      modelNo: snapshot.modelNo as string,
      taskId: snapshot.taskId as string,
      success:
        typeof snapshot.success === "boolean" ? snapshot.success : null,
      message: snapshot.message as string,
      payload: snapshot.payload,
    });
  } catch {
    return null;
  }
}

export async function loadInventoryTruthEvents() {
  const admin = await createSupabaseAdminClient();
  if (!admin) {
    return { events: [] as InventoryTruthEvent[], error: "SUPABASE_ADMIN_NOT_CONFIGURED" };
  }
  const result = await admin
    .from("commerce_operation_runs")
    .select("source_event_id,input_snapshot,started_at")
    .eq("operation_type", INVENTORY_TRUTH_OPERATION_TYPE)
    .eq("status", "SUCCEEDED")
    .order("started_at", { ascending: true })
    .limit(READ_LIMIT);
  if (result.error) {
    return { events: [] as InventoryTruthEvent[], error: result.error.message };
  }
  const events = (result.data ?? [])
    .map((row) => eventFromStoredRow(row as StoredRow))
    .filter((event): event is InventoryTruthEvent => Boolean(event));
  return { events, error: null };
}

function taskFromTarget(event: InventoryTruthEvent): ShoplingStockStateTask | null {
  if (
    event.action !== "SHOPLING_STATE_TARGET" ||
    !event.taskId ||
    !event.targetState ||
    !event.productKind
  ) {
    return null;
  }
  const payload = object(event.payload);
  const reason =
    payload.reason === "RECEIPT_RESTORE"
      ? "RECEIPT_RESTORE"
      : payload.reason === "MANUAL"
        ? "MANUAL"
        : "STOCKOUT_RESET";
  return {
    taskId: event.taskId,
    barcode: event.barcode,
    modelNo: event.modelNo,
    productKind: event.productKind,
    targetState: event.targetState,
    requestedAt: event.occurredAt,
    reason,
  };
}

function overlapDays(
  intervalStart: number,
  intervalEnd: number,
  bucketStart: number,
  bucketEnd: number,
) {
  const start = Math.max(intervalStart, bucketStart);
  const end = Math.min(intervalEnd, bucketEnd);
  return end > start ? (end - start) / DAY_MS : 0;
}

function stockoutDaysByBucket(
  events: InventoryTruthEvent[],
  analysisAsOf: string,
) {
  const endMs = Date.parse(analysisAsOf);
  const transitions = events
    .filter(
      (event) =>
        event.action === "SHOPLING_STATE_TARGET" &&
        event.targetState &&
        Number.isFinite(Date.parse(event.occurredAt)),
    )
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
  const intervals: Array<{ start: number; end: number }> = [];
  let soldOutStart: number | null = null;
  for (const transition of transitions) {
    const at = Date.parse(transition.occurredAt);
    if (transition.targetState === "SOLD_OUT" && soldOutStart === null) {
      soldOutStart = at;
    }
    if (transition.targetState === "ON_SALE" && soldOutStart !== null) {
      intervals.push({ start: soldOutStart, end: at });
      soldOutStart = null;
    }
  }
  if (soldOutStart !== null) intervals.push({ start: soldOutStart, end: endMs });
  return Array.from({ length: 12 }, (_, index) => {
    const bucketEnd = endMs - index * 30 * DAY_MS;
    const bucketStart = bucketEnd - 30 * DAY_MS;
    const days = intervals.reduce(
      (total, interval) =>
        total + overlapDays(interval.start, interval.end, bucketStart, bucketEnd),
      0,
    );
    return Math.max(0, Math.min(30, Math.round(days * 10) / 10));
  });
}

export function buildInventoryTruthSnapshot(
  events: InventoryTruthEvent[],
  salesEvents: CanonicalSaleEvent[],
  analysisAsOfInput = new Date().toISOString(),
): InventoryTruthSnapshot {
  const analysisAsOf = validIso(analysisAsOfInput);
  const byBarcodeEvents = new Map<string, InventoryTruthEvent[]>();
  for (const event of events) {
    const rows = byBarcodeEvents.get(event.barcode) ?? [];
    rows.push(event);
    byBarcodeEvents.set(event.barcode, rows);
  }
  const salesByBarcode = new Map<string, CanonicalSaleEvent[]>();
  for (const sale of salesEvents) {
    if (sale.validSale !== true) continue;
    const key = barcode(sale.barcode);
    if (!BARCODE_PATTERN.test(key)) continue;
    const rows = salesByBarcode.get(key) ?? [];
    rows.push(sale);
    salesByBarcode.set(key, rows);
  }

  const positions: InventoryTruthPosition[] = [];
  const pendingTasks: ShoplingStockStateTask[] = [];
  for (const [key, sourceEvents] of byBarcodeEvents) {
    const ordered = [...sourceEvents].sort(
      (left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
    );
    const reset = [...ordered]
      .reverse()
      .find((event) => event.action === "STOCKOUT_RESET");
    const resetAt = reset?.occurredAt ?? null;
    const resetMs = resetAt ? Date.parse(resetAt) : Number.NaN;
    const relevant = Number.isFinite(resetMs)
      ? ordered.filter((event) => Date.parse(event.occurredAt) >= resetMs)
      : ordered;
    const receivedAfterReset = resetAt
      ? relevant
          .filter((event) => event.action === "RECEIPT_CONFIRMED")
          .reduce((total, event) => total + event.quantity, 0)
      : 0;
    const soldAfterReset = resetAt
      ? (salesByBarcode.get(key) ?? [])
          .filter((sale) => Date.parse(text(sale.occurredAt)) >= resetMs)
          .reduce((total, sale) => total + integer(sale.quantity), 0)
      : 0;
    const targets = relevant.filter(
      (event) => event.action === "SHOPLING_STATE_TARGET" && event.targetState,
    );
    const latestTarget = targets.at(-1) ?? null;
    const syncResults = relevant.filter(
      (event) => event.action === "SHOPLING_SYNC_RESULT" && event.taskId,
    );
    const successfulTaskIds = new Set(
      syncResults
        .filter((event) => event.success === true)
        .map((event) => event.taskId as string),
    );
    const latestSuccessfulSync = [...syncResults]
      .reverse()
      .find((event) => event.success === true && event.targetState);
    const latestTask = latestTarget ? taskFromTarget(latestTarget) : null;
    const pendingTask =
      latestTask && !successfulTaskIds.has(latestTask.taskId) ? latestTask : null;
    if (pendingTask) pendingTasks.push(pendingTask);
    positions.push({
      barcode: key,
      exact: Boolean(resetAt),
      exactSince: resetAt,
      quantity: resetAt
        ? Math.max(0, receivedAfterReset - soldAfterReset)
        : null,
      receivedAfterReset,
      soldAfterReset,
      targetState: latestTarget?.targetState ?? null,
      shoplingSyncedState: latestSuccessfulSync?.targetState ?? null,
      productKind: latestTarget?.productKind ?? null,
      modelNo: latestTarget?.modelNo ?? null,
      stockoutDays: stockoutDaysByBucket(relevant, analysisAsOf),
      pendingTask,
    });
  }
  positions.sort((left, right) => left.barcode.localeCompare(right.barcode, "ko"));
  pendingTasks.sort(
    (left, right) =>
      Date.parse(left.requestedAt) - Date.parse(right.requestedAt) ||
      left.barcode.localeCompare(right.barcode, "ko"),
  );
  const byBarcode = new Map(positions.map((row) => [row.barcode, row] as const));
  return {
    generatedAt: new Date().toISOString(),
    analysisAsOf,
    positions,
    byBarcode,
    pendingTasks,
    fingerprint: sha256(
      positions.map((row) => ({
        barcode: row.barcode,
        exactSince: row.exactSince,
        quantity: row.quantity,
        targetState: row.targetState,
        shoplingSyncedState: row.shoplingSyncedState,
        pendingTaskId: row.pendingTask?.taskId ?? null,
      })),
    ),
    error: null,
  };
}

export async function loadInventoryTruthSnapshot(): Promise<InventoryTruthSnapshot> {
  const [ledger, sales] = await Promise.all([
    loadInventoryTruthEvents(),
    loadStage8CanonicalSalesEventSnapshot(),
  ]);
  const snapshot = buildInventoryTruthSnapshot(
    ledger.events,
    sales.events,
    sales.analysisAsOf ?? new Date().toISOString(),
  );
  return {
    ...snapshot,
    error:
      ledger.error ||
      (sales.state === "READY_READ_ONLY" ? null : "CANONICAL_SALES_NOT_READY"),
  };
}

async function resolveProductIdentity(barcodeInput: string) {
  const key = barcode(barcodeInput);
  const planning = await loadProductPlanningSnapshot();
  const row = planning.products.find(
    (product) => barcode(product.barcode) === key && product.skuActive !== false,
  );
  const optionName = text(row?.optionName).toLowerCase();
  const activeListings = (row?.listings ?? []).filter(
    (listing) => listing.active !== false,
  );
  const productKind: ShoplingProductKind =
    optionName === "단품" || optionName === "단일" || activeListings.length <= 1
      ? "SINGLE"
      : "OPTION";
  return {
    productKind,
    modelNo: text(row?.modelNo) || null,
  };
}

export async function recordStockoutReset(input: {
  barcode: string;
  productKind?: ShoplingProductKind;
  modelNo?: string | null;
  occurredAt?: string;
  note?: string;
}) {
  const key = barcode(input.barcode);
  const occurredAt = validIso(input.occurredAt);
  const identity =
    input.productKind && validProductKind(input.productKind)
      ? {
          productKind: input.productKind,
          modelNo: text(input.modelNo) || null,
        }
      : await resolveProductIdentity(key);
  const marker = `${key}:${occurredAt}`;
  const taskId = `shopling-stockout:${marker}`;
  const reset = await appendInventoryTruthEvent({
    sourceEventId: `stockout-reset:${marker}`,
    barcode: key,
    action: "STOCKOUT_RESET",
    occurredAt,
    quantity: 0,
    message: input.note || "운영자가 실제 품절을 확인해 재고 기준점을 0으로 초기화했습니다.",
  });
  const target = await appendInventoryTruthEvent({
    sourceEventId: `shopling-target:${taskId}`,
    barcode: key,
    action: "SHOPLING_STATE_TARGET",
    occurredAt,
    targetState: "SOLD_OUT",
    productKind: identity.productKind,
    modelNo: identity.modelNo,
    taskId,
    message: "품절 초기화에 따라 Shopling 판매상태 품절 동기화를 요청했습니다.",
    payload: { reason: "STOCKOUT_RESET" },
  });
  return { reset, target, taskId, identity };
}

export async function recordReceiptConfirmedAndMaybeRestore(input: {
  sourceSystem: string;
  sourceLineId: string;
  sourceEventId: string;
  barcode: string;
  quantityDelta: number;
  occurredAt?: string;
  note?: string;
}) {
  const key = barcode(input.barcode);
  const occurredAt = validIso(input.occurredAt);
  const receipt = await appendInventoryTruthEvent({
    sourceEventId: `receipt:${input.sourceSystem}:${input.sourceLineId}:${input.sourceEventId}`,
    barcode: key,
    action: "RECEIPT_CONFIRMED",
    occurredAt,
    quantity: input.quantityDelta,
    message: input.note || "입고확정 수량을 품절 초기화 이후 정확재고에 가산했습니다.",
    payload: {
      sourceSystem: input.sourceSystem,
      sourceLineId: input.sourceLineId,
      sourceEventId: input.sourceEventId,
    },
  });
  const current = await loadInventoryTruthSnapshot();
  const position = current.byBarcode.get(key);
  let restore: Awaited<ReturnType<typeof appendInventoryTruthEvent>> | null = null;
  let taskId: string | null = null;
  if (position?.exact && position.targetState === "SOLD_OUT") {
    const identity = await resolveProductIdentity(key);
    taskId = `shopling-on-sale:${key}:${occurredAt}`;
    restore = await appendInventoryTruthEvent({
      sourceEventId: `shopling-target:${taskId}`,
      barcode: key,
      action: "SHOPLING_STATE_TARGET",
      occurredAt,
      targetState: "ON_SALE",
      productKind: identity.productKind,
      modelNo: identity.modelNo,
      taskId,
      message: "입고확정으로 재고가 생겨 Shopling 판매중 복구를 요청했습니다.",
      payload: { reason: "RECEIPT_RESTORE" },
    });
  }
  return { receipt, restore, taskId };
}

export async function recordShoplingSyncResult(input: {
  taskId: string;
  barcode: string;
  targetState: ShoplingSaleState;
  productKind: ShoplingProductKind;
  success: boolean;
  occurredAt?: string;
  message?: string;
  payload?: unknown;
}) {
  return appendInventoryTruthEvent({
    sourceEventId: `shopling-result:${input.taskId}:${input.success ? "success" : "failure"}`,
    barcode: input.barcode,
    action: "SHOPLING_SYNC_RESULT",
    occurredAt: input.occurredAt,
    targetState: input.targetState,
    productKind: input.productKind,
    taskId: input.taskId,
    success: input.success,
    message: input.message,
    payload: input.payload,
  });
}

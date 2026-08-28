import {
  processReceiptAutomationEvent,
  validateReceiptAutomationEvent,
  type ReceiptAutomationEvent,
} from "@/lib/receiptAutomationControl";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

export const INTERNAL_CHINA_RECEIPT_DOWNSTREAM_OPERATION_TYPE =
  "INTERNAL_CHINA_RECEIPT_DOWNSTREAM";
const DOWNSTREAM_SOURCE = "ops-center-internal-china-receipt";
const DOWNSTREAM_SOURCE_PREFIX = "internal-china-receipt-downstream:";
const DEFAULT_PRODUCT_MASTER_URL =
  "https://commerce-os-product-master.vercel.app";
const STALE_RUNNING_MINUTES = 10;

export type InternalChinaReceiptDownstreamItem = {
  externalId: string;
  barcode: string;
  modelNumber: string;
  productName: string;
  optionName: string;
  quantity: number;
  unitCostKrw: number;
};

export type InternalChinaReceiptDownstreamEvent = ReceiptAutomationEvent & {
  items: InternalChinaReceiptDownstreamItem[];
};

type OperationRow = {
  id?: unknown;
  status?: unknown;
  source_event_id?: unknown;
  input_snapshot?: unknown;
  result_snapshot?: unknown;
  started_at?: unknown;
  updated_at?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function iso(value: unknown) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function sourceEventId(eventId: string) {
  return `${DOWNSTREAM_SOURCE_PREFIX}${eventId}`;
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { baseUrl, secret };
}

async function rest<T>(input: {
  method?: "GET" | "POST" | "PATCH";
  query?: URLSearchParams;
  body?: unknown;
  prefer?: string;
}) {
  const { baseUrl, secret } = supabaseConnection();
  const query = input.query ?? new URLSearchParams();
  const response = await fetch(
    `${baseUrl}/rest/v1/commerce_operation_runs?${query.toString()}`,
    {
      method: input.method ?? "GET",
      headers: {
        ...createSupabaseAdminHeaders(secret),
        ...(input.prefer ? { Prefer: input.prefer } : {}),
      },
      body:
        input.method === "POST" || input.method === "PATCH"
          ? JSON.stringify(input.body)
          : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(
      `INTERNAL_CHINA_RECEIPT_DOWNSTREAM_STORE_FAILED:${response.status}:${raw.slice(0, 400)}`,
    );
  }
  return (raw ? JSON.parse(raw) : null) as T;
}

export function buildInternalChinaReceiptDownstreamOperation(
  event: InternalChinaReceiptDownstreamEvent,
  queuedAt = event.occurredAt,
) {
  return {
    operation_type: INTERNAL_CHINA_RECEIPT_DOWNSTREAM_OPERATION_TYPE,
    status: "PENDING",
    source: DOWNSTREAM_SOURCE,
    source_event_id: sourceEventId(event.eventId),
    correlation_id: event.eventId,
    actor_type: "OPS_OPERATOR",
    actor_id: event.ownerEmail,
    input_snapshot: event,
    result_snapshot: {
      attempts: 0,
      productMasterImported: false,
      priceAnalysisTriggered: false,
    },
    error_message: null,
    started_at: queuedAt,
    finished_at: null,
    updated_at: queuedAt,
  };
}

export function validateInternalChinaReceiptDownstreamEvent(
  value: unknown,
): InternalChinaReceiptDownstreamEvent {
  const base = validateReceiptAutomationEvent(value);
  const raw = object(value);
  if (!Array.isArray(raw.items) || !raw.items.length) {
    throw new Error("INTERNAL_CHINA_RECEIPT_DOWNSTREAM_ITEMS_REQUIRED");
  }
  const externalIds = new Set<string>();
  const items = raw.items.map((value, index) => {
    const row = object(value);
    const externalId = text(row.externalId);
    const barcode = text(row.barcode).toUpperCase().replace(/\s+/g, "");
    const modelNumber = text(row.modelNumber) || barcode;
    const productName = text(row.productName) || modelNumber;
    const optionName = text(row.optionName);
    const quantity = positiveInteger(row.quantity);
    const unitCostKrw = positiveInteger(row.unitCostKrw);
    if (!externalId || externalIds.has(externalId)) {
      throw new Error(
        `INTERNAL_CHINA_RECEIPT_DOWNSTREAM_ITEM_ID_INVALID:${index + 1}`,
      );
    }
    externalIds.add(externalId);
    if (!/^[A-Z]{3}\d+-\d+$/.test(barcode)) {
      throw new Error(
        `INTERNAL_CHINA_RECEIPT_DOWNSTREAM_BARCODE_INVALID:${index + 1}`,
      );
    }
    if (!quantity || !unitCostKrw) {
      throw new Error(
        `INTERNAL_CHINA_RECEIPT_DOWNSTREAM_ITEM_VALUE_INVALID:${barcode}`,
      );
    }
    return {
      externalId,
      barcode,
      modelNumber,
      productName,
      optionName,
      quantity,
      unitCostKrw,
    };
  });
  const itemQuantity = items.reduce((sum, row) => sum + row.quantity, 0);
  if (itemQuantity !== base.totals.good) {
    throw new Error(
      `INTERNAL_CHINA_RECEIPT_DOWNSTREAM_QUANTITY_MISMATCH:${itemQuantity}:${base.totals.good}`,
    );
  }
  return { ...base, items };
}

async function readNextOperation() {
  const select =
    "id,status,source_event_id,input_snapshot,result_snapshot,started_at,updated_at";
  const pendingQuery = new URLSearchParams({
    operation_type: `eq.${INTERNAL_CHINA_RECEIPT_DOWNSTREAM_OPERATION_TYPE}`,
    status: "in.(PENDING,FAILED)",
    select,
    order: "started_at.asc",
    limit: "1",
  });
  const pending = await rest<OperationRow[]>({ query: pendingQuery });
  if (Array.isArray(pending) && pending[0]) return pending[0];

  const staleBefore = new Date(
    Date.now() - STALE_RUNNING_MINUTES * 60_000,
  ).toISOString();
  const staleQuery = new URLSearchParams({
    operation_type: `eq.${INTERNAL_CHINA_RECEIPT_DOWNSTREAM_OPERATION_TYPE}`,
    status: "eq.RUNNING",
    updated_at: `lt.${staleBefore}`,
    select,
    order: "updated_at.asc",
    limit: "1",
  });
  const stale = await rest<OperationRow[]>({ query: staleQuery });
  return Array.isArray(stale) ? stale[0] ?? null : null;
}

async function claimOperation(row: OperationRow) {
  const id = text(row.id);
  const status = text(row.status);
  if (!id || !status) return null;
  const previous = object(row.result_snapshot);
  const attempts = Math.max(0, Number(previous.attempts) || 0) + 1;
  const claimedAt = new Date().toISOString();
  const query = new URLSearchParams({
    id: `eq.${id}`,
    status: `eq.${status}`,
    select:
      "id,status,source_event_id,input_snapshot,result_snapshot,started_at,updated_at",
  });
  const claimed = await rest<OperationRow[]>({
    method: "PATCH",
    query,
    prefer: "return=representation",
    body: {
      status: "RUNNING",
      result_snapshot: {
        ...previous,
        attempts,
        claimedAt,
      },
      error_message: null,
      finished_at: null,
      updated_at: claimedAt,
    },
  });
  return Array.isArray(claimed) ? claimed[0] ?? null : null;
}

async function updateOperation(
  id: string,
  values: Record<string, unknown>,
) {
  await rest<OperationRow[]>({
    method: "PATCH",
    query: new URLSearchParams({ id: `eq.${id}` }),
    prefer: "return=representation",
    body: values,
  });
}

async function pushConfirmedReceiptToProductMaster(
  event: InternalChinaReceiptDownstreamEvent,
) {
  const secret = process.env.PRODUCT_MASTER_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRODUCT_MASTER_INTEGRATION_SECRET_MISSING");
  const baseUrl = (
    process.env.PRODUCT_MASTER_BASE_URL?.trim() || DEFAULT_PRODUCT_MASTER_URL
  ).replace(/\/$/, "");
  const response = await fetch(
    `${baseUrl}/api/integrations/confirmed-receipts`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-commerce-os-integration-secret": secret,
      },
      body: JSON.stringify(event),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    },
  );
  const raw = await response.text();
  const body = raw ? JSON.parse(raw) : {};
  if (!response.ok || body?.ok !== true) {
    throw new Error(
      `PRODUCT_MASTER_CONFIRMED_RECEIPT_FAILED:${response.status}:${text(body?.message || body?.error || raw)}`,
    );
  }
  return body as Record<string, unknown>;
}

export async function runInternalChinaReceiptDownstreamStep() {
  const candidate = await readNextOperation();
  if (!candidate) {
    return {
      processed: false as const,
      state: "IDLE" as const,
      message: "후속 처리할 중국 입고확정 이벤트가 없습니다.",
    };
  }
  const claimed = await claimOperation(candidate);
  if (!claimed) {
    return {
      processed: false as const,
      state: "CLAIMED_BY_OTHER_WORKER" as const,
      message: "다른 Worker가 중국 입고 후속 처리를 시작했습니다.",
    };
  }

  const id = text(claimed.id);
  const previous = object(claimed.result_snapshot);
  const attempts = Math.max(1, Number(previous.attempts) || 1);
  try {
    const event = validateInternalChinaReceiptDownstreamEvent(
      claimed.input_snapshot,
    );
    const productMaster = await pushConfirmedReceiptToProductMaster(event);
    const priceAutomation = await processReceiptAutomationEvent(event);
    const completedAt = new Date().toISOString();
    await updateOperation(id, {
      status: "SUCCEEDED",
      result_snapshot: {
        attempts,
        productMasterImported: true,
        productMaster,
        priceAnalysisTriggered: true,
        priceAutomation,
        completedAt,
      },
      error_message: null,
      finished_at: completedAt,
      updated_at: completedAt,
    });
    return {
      processed: true as const,
      state: "SUCCEEDED" as const,
      receiptId: event.receiptId,
      eventId: event.eventId,
      itemCount: event.items.length,
      quantity: event.totals.good,
      productMaster,
      priceAutomation,
      message:
        "Product Master 입고재고·입고원가와 가격분석 후속 처리를 완료했습니다.",
    };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const message =
      error instanceof Error
        ? error.message
        : "INTERNAL_CHINA_RECEIPT_DOWNSTREAM_FAILED";
    await updateOperation(id, {
      status: "FAILED",
      result_snapshot: {
        ...previous,
        attempts,
        lastFailedAt: failedAt,
      },
      error_message: message.slice(0, 2000),
      finished_at: failedAt,
      updated_at: failedAt,
    });
    throw error;
  }
}

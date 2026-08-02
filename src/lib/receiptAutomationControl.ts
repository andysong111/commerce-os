const DEFAULT_PRICE_ENGINE_URL =
  "https://commerce-os-price-adjustment-engine.andy123df23.chatgpt.site";
const INTEGRATION_HEADER = "x-commerce-os-integration-secret";

export type ReceiptAutomationEvent = {
  eventId: string;
  eventType: "receipt.confirmed.v1";
  occurredAt: string;
  receiptId: string;
  batchId: number;
  ownerEmail: string;
  workflowState: "RECEIVED";
  totals: {
    good: number;
    damaged: number;
    missing: number;
  };
  barcodes: string[];
};

type OperationRun = {
  id: string;
  status: string;
  source_event_id: string;
  correlation_id: string;
  result_snapshot?: Record<string, unknown>;
};

type PriceAnalysisResult = {
  ok?: boolean;
  runId?: string;
  status?: string;
  productsAnalyzed?: number;
  increaseCount?: number;
  decreaseReviewCount?: number;
  discontinuedReviewCount?: number;
  holdCount?: number;
  blockedCount?: number;
  finishedAt?: string;
  error?: string;
  message?: string;
};

export function validateReceiptAutomationEvent(
  value: unknown,
): ReceiptAutomationEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("입고확정 이벤트 객체가 필요합니다.");
  }
  const raw = value as Record<string, unknown>;
  const eventId = text(raw.eventId);
  const eventType = text(raw.eventType);
  const occurredAt = validIso(raw.occurredAt);
  const receiptId = text(raw.receiptId);
  const batchId = Number(raw.batchId);
  const ownerEmail = text(raw.ownerEmail).toLowerCase();
  const workflowState = text(raw.workflowState);
  const totalsRaw =
    raw.totals && typeof raw.totals === "object" && !Array.isArray(raw.totals)
      ? (raw.totals as Record<string, unknown>)
      : {};
  const barcodes = [
    ...new Set(
      (Array.isArray(raw.barcodes) ? raw.barcodes : [])
        .map((item) => text(item).toUpperCase())
        .filter(Boolean),
    ),
  ];

  if (!uuid(eventId)) throw new Error("입고확정 이벤트 번호가 올바르지 않습니다.");
  if (eventType !== "receipt.confirmed.v1") {
    throw new Error("지원하지 않는 입고확정 이벤트입니다.");
  }
  if (!occurredAt) throw new Error("입고확정 시각이 올바르지 않습니다.");
  if (!uuid(receiptId)) throw new Error("입고확정 번호가 올바르지 않습니다.");
  if (!Number.isInteger(batchId) || batchId <= 0) {
    throw new Error("발주차시 번호가 올바르지 않습니다.");
  }
  if (!ownerEmail || ownerEmail.length > 320) {
    throw new Error("입고확정 실행자를 확인할 수 없습니다.");
  }
  if (workflowState !== "RECEIVED") {
    throw new Error("RECEIVED 상태의 입고확정만 자동화할 수 있습니다.");
  }
  if (!barcodes.length) {
    throw new Error("가격분석할 입고 바코드가 없습니다.");
  }

  return {
    eventId,
    eventType: "receipt.confirmed.v1",
    occurredAt,
    receiptId,
    batchId,
    ownerEmail,
    workflowState: "RECEIVED",
    totals: {
      good: nonNegative(totalsRaw.good),
      damaged: nonNegative(totalsRaw.damaged),
      missing: nonNegative(totalsRaw.missing),
    },
    barcodes,
  };
}

export async function processReceiptAutomationEvent(
  event: ReceiptAutomationEvent,
) {
  const store = operationStore();
  const processed = await store.selectOne<Record<string, unknown>>(
    "commerce_processed_events",
    { event_id: event.eventId },
  );
  if (processed) {
    return {
      ok: true as const,
      idempotent: true as const,
      correlationId: event.eventId,
      result: processed.result_snapshot ?? {},
    };
  }

  const existing = await store.selectOne<OperationRun>(
    "commerce_operation_runs",
    { source_event_id: event.eventId },
  );
  if (existing && ["AWAITING_APPROVAL", "SUCCEEDED"].includes(existing.status)) {
    await recordProcessedEvent(store, event, existing.id, existing.result_snapshot ?? {});
    return {
      ok: true as const,
      idempotent: true as const,
      correlationId: event.eventId,
      operationRunId: existing.id,
      result: existing.result_snapshot ?? {},
    };
  }

  const runId = existing?.id || event.eventId;
  const inputSnapshot = {
    receiptId: event.receiptId,
    batchId: event.batchId,
    workflowState: event.workflowState,
    totals: event.totals,
    barcodes: event.barcodes,
    occurredAt: event.occurredAt,
  };

  await store.upsert(
    "commerce_operation_runs",
    {
      id: runId,
      operation_type: "PRICE_ANALYSIS_FROM_RECEIPT",
      status: "RUNNING",
      source: "china_order_manager",
      source_event_id: event.eventId,
      correlation_id: event.eventId,
      actor_type: "USER_TRIGGERED_AUTOMATION",
      actor_id: event.ownerEmail,
      input_snapshot: inputSnapshot,
      result_snapshot: {},
      error_message: null,
      started_at: new Date().toISOString(),
      finished_at: null,
    },
    "source_event_id",
  );

  await upsertHealth(store, {
    sourceKey: "confirmed_receipts",
    status: "FRESH",
    generatedAt: event.occurredAt,
    maxAgeMinutes: 5,
    details: {
      receiptId: event.receiptId,
      batchId: event.batchId,
      barcodeCount: event.barcodes.length,
      correlationId: event.eventId,
    },
  });

  try {
    const analysis = await triggerPriceAnalysis(event);
    const resultSnapshot = {
      priceAnalysisRunId: analysis.runId ?? null,
      status: analysis.status ?? "COMPLETED",
      productsAnalyzed: number(analysis.productsAnalyzed),
      increaseCount: number(analysis.increaseCount),
      decreaseReviewCount: number(analysis.decreaseReviewCount),
      discontinuedReviewCount: number(analysis.discontinuedReviewCount),
      holdCount: number(analysis.holdCount),
      blockedCount: number(analysis.blockedCount),
      generatedAt: analysis.finishedAt || new Date().toISOString(),
      shoplingExecution: "REQUIRES_FINAL_APPROVAL",
    };

    await store.update(
      "commerce_operation_runs",
      {
        status: "AWAITING_APPROVAL",
        result_snapshot: resultSnapshot,
        error_message: null,
        finished_at: new Date().toISOString(),
      },
      { id: runId },
    );
    await upsertHealth(store, {
      sourceKey: "price_recommendations",
      status: "FRESH",
      generatedAt: String(resultSnapshot.generatedAt),
      maxAgeMinutes: 1440,
      details: {
        correlationId: event.eventId,
        priceAnalysisRunId: analysis.runId ?? null,
        shoplingExecution: "BLOCKED_UNTIL_FINAL_APPROVAL",
      },
    });
    await store.insert("commerce_audit_logs", {
      operation_run_id: runId,
      correlation_id: event.eventId,
      actor_type: "USER_TRIGGERED_AUTOMATION",
      actor_id: event.ownerEmail,
      action: "receipt_confirmed.price_analysis_generated",
      entity_type: "receipt",
      entity_id: event.receiptId,
      before_snapshot: null,
      after_snapshot: resultSnapshot,
      metadata: {
        batchId: event.batchId,
        approvalRequired: true,
      },
    });
    await recordProcessedEvent(store, event, runId, resultSnapshot);

    return {
      ok: true as const,
      idempotent: false as const,
      correlationId: event.eventId,
      operationRunId: runId,
      status: "AWAITING_APPROVAL" as const,
      result: resultSnapshot,
      message:
        "입고 원가·재고 반영 후 가격분석과 변경안 생성을 완료했습니다. Shopling 적용은 최종 승인이 필요합니다.",
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "UNKNOWN_PRICE_ANALYSIS_TRIGGER_ERROR";
    await store.update(
      "commerce_operation_runs",
      {
        status: "FAILED",
        error_message: message.slice(0, 2000),
        finished_at: new Date().toISOString(),
      },
      { id: runId },
    );
    await upsertHealth(store, {
      sourceKey: "price_recommendations",
      status: "FAILED",
      generatedAt: null,
      maxAgeMinutes: 1440,
      details: {
        correlationId: event.eventId,
        error: message.slice(0, 1000),
      },
    });
    await store.insert("commerce_audit_logs", {
      operation_run_id: runId,
      correlation_id: event.eventId,
      actor_type: "USER_TRIGGERED_AUTOMATION",
      actor_id: event.ownerEmail,
      action: "receipt_confirmed.price_analysis_failed",
      entity_type: "receipt",
      entity_id: event.receiptId,
      before_snapshot: null,
      after_snapshot: null,
      metadata: { error: message.slice(0, 1000) },
    });
    throw error;
  }
}

async function triggerPriceAnalysis(event: ReceiptAutomationEvent) {
  const secret = process.env.PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET?.trim();
  if (!secret) throw new Error("PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET_REQUIRED");
  const baseUrl = (
    process.env.NEXT_PUBLIC_PRICE_ADJUSTMENT_ENGINE_URL?.trim() ||
    DEFAULT_PRICE_ENGINE_URL
  ).replace(/\/$/, "");
  if (!/^https:\/\//.test(baseUrl)) {
    throw new Error("PRICE_ADJUSTMENT_ENGINE_URL_REQUIRED");
  }

  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      [INTEGRATION_HEADER]: secret,
    },
    body: JSON.stringify({
      source: "receipt_confirmation",
      correlationId: event.eventId,
      receiptId: event.receiptId,
      batchId: event.batchId,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(50_000),
  });
  const body = (await response.json().catch(() => ({}))) as PriceAnalysisResult;
  if (!response.ok || body.ok !== true) {
    throw new Error(
      `PRICE_ANALYSIS_TRIGGER_FAILED:${response.status}:${body.message || body.error || "UNKNOWN"}`,
    );
  }
  return body;
}

async function recordProcessedEvent(
  store: ReturnType<typeof operationStore>,
  event: ReceiptAutomationEvent,
  operationRunId: string,
  result: Record<string, unknown>,
) {
  await store.upsert(
    "commerce_processed_events",
    {
      event_id: event.eventId,
      event_type: event.eventType,
      correlation_id: event.eventId,
      operation_run_id: operationRunId,
      result_snapshot: result,
      processed_at: new Date().toISOString(),
    },
    "event_id",
  );
}

async function upsertHealth(
  store: ReturnType<typeof operationStore>,
  input: {
    sourceKey: string;
    status: "FRESH" | "STALE" | "MISSING" | "FAILED";
    generatedAt: string | null;
    maxAgeMinutes: number;
    details: Record<string, unknown>;
  },
) {
  await store.upsert(
    "commerce_data_source_health",
    {
      source_key: input.sourceKey,
      status: input.status,
      generated_at: input.generatedAt,
      received_at: new Date().toISOString(),
      max_age_minutes: input.maxAgeMinutes,
      details: input.details,
      updated_at: new Date().toISOString(),
    },
    "source_key",
  );
}

function operationStore() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) {
    throw new Error("OPS_CONTROL_SUPABASE_CONFIGURATION_REQUIRED");
  }

  const headers = () => {
    const value: Record<string, string> = {
      apikey: secret,
      accept: "application/json",
      "content-type": "application/json",
    };
    if (!secret.startsWith("sb_secret_")) {
      value.authorization = `Bearer ${secret}`;
    }
    return value;
  };

  const request = async <T>(
    table: string,
    init: RequestInit,
    query = new URLSearchParams(),
  ): Promise<T> => {
    const response = await fetch(
      `${baseUrl}/rest/v1/${encodeURIComponent(table)}?${query.toString()}`,
      { ...init, headers: { ...headers(), ...(init.headers || {}) }, cache: "no-store" },
    );
    const textBody = await response.text();
    let body: unknown = null;
    if (textBody) {
      try {
        body = JSON.parse(textBody);
      } catch {
        body = textBody;
      }
    }
    if (!response.ok) {
      const detail =
        body && typeof body === "object" && "message" in body
          ? String((body as { message?: unknown }).message || "")
          : String(body || "");
      throw new Error(
        `OPS_CONTROL_STORE_FAILED:${table}:${response.status}:${detail.slice(0, 500)}`,
      );
    }
    return body as T;
  };

  return {
    async selectOne<T>(table: string, filters: Record<string, unknown>) {
      const query = filtersQuery(filters);
      query.set("select", "*");
      query.set("limit", "1");
      const rows = await request<T[]>(table, { method: "GET" }, query);
      return Array.isArray(rows) ? rows[0] ?? null : null;
    },
    async insert(table: string, row: Record<string, unknown>) {
      return request<unknown[]>(table, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(row),
      });
    },
    async upsert(
      table: string,
      row: Record<string, unknown>,
      conflictColumn: string,
    ) {
      const query = new URLSearchParams({ on_conflict: conflictColumn });
      return request<unknown[]>(
        table,
        {
          method: "POST",
          headers: {
            Prefer: "resolution=merge-duplicates,return=representation",
          },
          body: JSON.stringify(row),
        },
        query,
      );
    },
    async update(
      table: string,
      values: Record<string, unknown>,
      filters: Record<string, unknown>,
    ) {
      return request<unknown[]>(
        table,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(values),
        },
        filtersQuery(filters),
      );
    },
  };
}

function filtersQuery(filters: Record<string, unknown>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    query.append(key, `eq.${String(value)}`);
  }
  return query;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}
function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
function validIso(value: unknown) {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : "";
}
function nonNegative(value: unknown) {
  return Math.max(0, Number(value) || 0);
}
function number(value: unknown) {
  return Math.max(0, Math.round(Number(value) || 0));
}

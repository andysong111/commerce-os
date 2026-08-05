import { timingSafeEqual } from "node:crypto";
import {
  CHINA_ORDER_EVENT_OPERATION_TYPE,
  loadChinaOrderLedger,
  normalizeChinaOrderCommitmentEvent,
  type ChinaOrderCommitmentEventInput,
} from "@/lib/chinaOrderLedger";
import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function serviceAuthorized(request: Request) {
  const supplied = request.headers
    .get("x-commerce-os-integration-secret")
    ?.trim();
  if (!supplied) return false;
  const candidates = [
    process.env.CHINA_ORDER_MANAGER_INTEGRATION_SECRET,
    process.env.PRODUCT_DECISION_AGENT_INTEGRATION_SECRET,
    process.env.PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET,
  ]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean);
  return candidates.some((expected) => secureEqual(expected, supplied));
}

function authorized(request: Request) {
  return isSameOriginOpsRequest(request) || serviceAuthorized(request);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      {
        ok: false,
        code: "CHINA_ORDER_LEDGER_UNAUTHORIZED",
        message: "중국 발주 원장을 조회할 권한이 필요합니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const ledger = await loadChinaOrderLedger();
  return Response.json(
    {
      ok: !ledger.error,
      ...ledger,
    },
    {
      status: ledger.error ? 503 : 200,
      headers: { "cache-control": "no-store" },
    },
  );
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      {
        ok: false,
        code: "CHINA_ORDER_LEDGER_UNAUTHORIZED",
        message: "중국 주문·입고 이벤트를 저장할 권한이 필요합니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const body = (await request.json()) as ChinaOrderCommitmentEventInput;
    const event = normalizeChinaOrderCommitmentEvent(body);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(
      /\/$/,
      "",
    );
    const supabaseSecretKey = (
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )?.trim();
    if (!supabaseUrl || !supabaseSecretKey) {
      return Response.json(
        {
          ok: false,
          code: "SUPABASE_ADMIN_NOT_CONFIGURED",
          message: "Ops Center 운영 원장 저장 연결이 설정되지 않았습니다.",
        },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }

    const sourceEventId =
      `china-order:${encodeURIComponent(event.sourceSystem)}:` +
      encodeURIComponent(event.sourceEventId);
    const correlationId =
      `china-order-line:${encodeURIComponent(event.sourceSystem)}:` +
      encodeURIComponent(event.sourceLineId);
    const response = await fetch(
      `${supabaseUrl}/rest/v1/commerce_operation_runs?on_conflict=source_event_id&select=id,source_event_id,started_at`,
      {
        method: "POST",
        headers: {
          ...createSupabaseAdminHeaders(supabaseSecretKey),
          Prefer: "resolution=ignore-duplicates,return=representation",
        },
        body: JSON.stringify([
          {
            operation_type: CHINA_ORDER_EVENT_OPERATION_TYPE,
            status: "SUCCEEDED",
            source: event.sourceSystem,
            source_event_id: sourceEventId,
            correlation_id: correlationId,
            actor_type: serviceAuthorized(request)
              ? "COMMERCE_OS_SERVICE"
              : "OPS_OPERATOR",
            input_snapshot: event,
            result_snapshot: {
              accepted: true,
              sourceLineId: event.sourceLineId,
              barcode: event.barcode,
              eventStatus: event.status,
            },
            error_message: null,
            started_at: event.occurredAt,
            finished_at: event.occurredAt,
            updated_at: event.occurredAt,
          },
        ]),
        cache: "no-store",
      },
    );
    const text = await response.text();
    const responseBody = text ? safeJson(text) : null;
    if (!response.ok) {
      return Response.json(
        {
          ok: false,
          code: "CHINA_ORDER_EVENT_STORE_FAILED",
          message: readMessage(responseBody, response.status),
        },
        { status: 500, headers: { "cache-control": "no-store" } },
      );
    }
    const storedRows = Array.isArray(responseBody) ? responseBody : [];
    return Response.json(
      {
        ok: true,
        duplicate: storedRows.length === 0,
        sourceEventId,
        correlationId,
        event,
        message:
          storedRows.length === 0
            ? "이미 처리한 중국 주문·입고 이벤트라 중복 저장하지 않았습니다."
            : "중국 주문·입고 이벤트를 Ops Center 불변 원장에 저장했습니다.",
      },
      {
        status: storedRows.length === 0 ? 200 : 201,
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "CHINA_ORDER_EVENT_INVALID",
        message:
          error instanceof Error
            ? error.message
            : "중국 주문·입고 이벤트 형식을 확인하지 못했습니다.",
      },
      { status: 400, headers: { "cache-control": "no-store" } },
    );
  }
}

function safeJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function readMessage(value: unknown, status: number) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    if (typeof row.message === "string") return row.message;
  }
  return `Ops Center 원장 저장 요청에 실패했습니다. status=${status}`;
}

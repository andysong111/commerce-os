import { isSameOriginOpsRequest } from "@/lib/opsLoginBypass";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_STEP_FAILURE } from "@/lib/productMasterShoplingDiagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function safeMessage(value: unknown) {
  return text(value)
    .slice(0, 500)
    .replace(/<(?:login_id|company_id|api_auth_key)>[\s\S]*?<\/(?:login_id|company_id|api_auth_key)>/gi, "[redacted]")
    .replace(/[A-Za-z0-9+/=_-]{48,}/g, "[redacted]");
}

export async function GET(request: Request) {
  if (!isSameOriginOpsRequest(request)) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_UNAUTHORIZED",
        message: "상품마스터 Shopling 재시도 진단을 조회할 권한이 필요합니다.",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const admin = await createSupabaseAdminClient();
    if (!admin) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
    const result = await admin
      .from("commerce_operation_runs")
      .select(
        "source_event_id,correlation_id,status,input_snapshot,result_snapshot,error_message,started_at",
      )
      .eq("operation_type", PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_STEP_FAILURE)
      .order("started_at", { ascending: false })
      .limit(10);
    if (result.error) throw new Error(result.error.message);

    const failures = (Array.isArray(result.data) ? result.data : []).map((row) => {
      const input = object(row.input_snapshot);
      const range = object(input.range);
      return {
        sourceEventId: text(row.source_event_id),
        correlationId: text(row.correlation_id),
        attempt: Math.max(0, Math.round(Number(input.attempt) || 0)),
        range: {
          start: text(range.start),
          end: text(range.end),
        },
        message: safeMessage(row.error_message),
        startedAt: text(row.started_at),
      };
    });

    return Response.json(
      { ok: true, failures },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_FAILURES_QUERY_FAILED",
        message:
          error instanceof Error
            ? safeMessage(error.message)
            : "상품마스터 Shopling 재시도 진단을 불러오지 못했습니다.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

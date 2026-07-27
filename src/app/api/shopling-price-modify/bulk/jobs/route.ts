import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { validateShoplingPriceBulkCreateInput } from "@/lib/shoplingPriceModifyBulkServer";

type Result = { data: unknown; error: unknown };
type Query = PromiseLike<Result> & {
  select(columns: string): Query;
  eq(column: string, value: string): Query;
  is(column: string, value: null | boolean): Query;
  not(column: string, operator: "is", value: null | boolean): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
};
type Admin = { rpc(name: string, parameters: Record<string, unknown>): Promise<Result>; from(table: string): Query };

type SessionResult =
  | { response: NextResponse; ownerId?: never; admin?: never }
  | { ownerId: string; admin: Admin; response?: never };

type DiagnosticOptions = {
  status: number;
  code: string;
  stage: string;
  message: string;
  detail?: unknown;
};

function redactDiagnostic(value: string) {
  return value
    .replace(/sb_secret_[A-Za-z0-9._-]+/g, "[REDACTED_SUPABASE_SECRET]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .slice(0, 2000);
}

function diagnosticDetail(detail: unknown) {
  if (detail === undefined || detail === null) return undefined;
  if (detail instanceof Error) return redactDiagnostic(detail.message);
  if (typeof detail === "string") return redactDiagnostic(detail);
  try {
    return redactDiagnostic(JSON.stringify(detail));
  } catch {
    return redactDiagnostic(String(detail));
  }
}

function diagnosticResponse({ status, code, stage, message, detail }: DiagnosticOptions) {
  const diagnosticId = `bulk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const safeDetail = diagnosticDetail(detail);
  console.error(`[shopling-price-bulk:${diagnosticId}]`, { code, stage, detail: safeDetail });
  return NextResponse.json({
    error: message,
    code,
    stage,
    detail: safeDetail,
    diagnostic_id: diagnosticId,
  }, { status });
}

async function session(): Promise<SessionResult> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return {
        response: diagnosticResponse({
          status: 503,
          code: "SUPABASE_PUBLIC_CONFIG_MISSING",
          stage: "session.create_public_client",
          message: "Supabase 공개 설정이 필요합니다.",
        }),
      };
    }

    const { data, error } = await supabase.auth.getUser();
    if (error) {
      return {
        response: diagnosticResponse({
          status: 401,
          code: "SUPABASE_SESSION_LOOKUP_FAILED",
          stage: "session.get_user",
          message: "로그인 세션을 확인할 수 없습니다.",
          detail: error,
        }),
      };
    }
    if (!data.user) {
      return {
        response: diagnosticResponse({
          status: 401,
          code: "LOGIN_REQUIRED",
          stage: "session.get_user",
          message: "로그인이 필요합니다.",
        }),
      };
    }

    const admin = await createSupabaseAdminClient();
    if (!admin) {
      return {
        response: diagnosticResponse({
          status: 503,
          code: "SUPABASE_ADMIN_CONFIG_MISSING",
          stage: "session.create_admin_client",
          message: "Supabase 서버 비밀키 설정이 필요합니다. Vercel의 SUPABASE_SECRET_KEY 또는 SUPABASE_SERVICE_ROLE_KEY를 확인하세요.",
        }),
      };
    }
    return { ownerId: data.user.id, admin: admin as Admin };
  } catch (error) {
    return {
      response: diagnosticResponse({
        status: 500,
        code: "SUPABASE_SESSION_CONNECTION_FAILED",
        stage: "session.unhandled",
        message: "Supabase 서버 연결에 실패했습니다.",
        detail: error,
      }),
    };
  }
}

export async function POST(request: Request) {
  try {
    const auth = await session();
    if (auth.response) return auth.response;

    let input;
    try {
      input = validateShoplingPriceBulkCreateInput(await request.json());
    } catch (error) {
      return diagnosticResponse({
        status: 400,
        code: "BULK_INPUT_INVALID",
        stage: "create.validate_input",
        message: error instanceof Error ? error.message : "입력 통계가 일치하지 않습니다.",
        detail: error,
      });
    }

    const { data, error } = await auth.admin.rpc("create_shopling_price_bulk_prepared_job", {
      p_owner_id: auth.ownerId,
      p_input_source: input.inputSource,
      p_goods_keys: input.goodsKeys,
      p_original_count: input.originalCount,
      p_duplicate_count: input.duplicateCount,
      p_invalid_count: input.invalidCount,
    });
    if (error || !data) {
      return diagnosticResponse({
        status: 500,
        code: "BULK_PREPARED_JOB_RPC_FAILED",
        stage: "create.rpc.create_shopling_price_bulk_prepared_job",
        message: "Bulk 작업 저장에 실패했습니다.",
        detail: error ?? "Supabase RPC가 빈 응답을 반환했습니다.",
      });
    }

    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
    return NextResponse.json({
      id: row.id,
      status: row.status,
      valid_count: row.valid_count,
      total_chunk_count: row.total_chunk_count,
      canary_size: row.canary_size,
      normal_chunk_count: Number(row.total_chunk_count) - 1,
      created_at: row.created_at,
    }, { status: 201 });
  } catch (error) {
    return diagnosticResponse({
      status: 500,
      code: "BULK_PREPARED_JOB_CREATE_UNHANDLED",
      stage: "create.unhandled",
      message: "Bulk 작업 저장 중 서버 오류가 발생했습니다.",
      detail: error,
    });
  }
}

export async function GET(request: Request) {
  try {
    const auth = await session();
    if (auth.response) return auth.response;
    const archived = new URL(request.url).searchParams.get("archived") === "1";

    let query = auth.admin.from("shopling_price_bulk_jobs")
      .select("id,status,input_source,original_count,valid_count,duplicate_count,invalid_count,total_chunk_count,execution_mode,archived_at,archive_note,created_at,updated_at")
      .eq("owner_id", auth.ownerId);
    query = archived ? query.not("archived_at", "is", null) : query.is("archived_at", null);
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(archived ? 20 : 10);
    if (error) {
      return diagnosticResponse({
        status: 500,
        code: "BULK_JOB_LIST_QUERY_FAILED",
        stage: "list.query.shopling_price_bulk_jobs",
        message: "Bulk 작업 조회에 실패했습니다.",
        detail: error,
      });
    }
    return NextResponse.json({ jobs: data ?? [], archived });
  } catch (error) {
    return diagnosticResponse({
      status: 500,
      code: "BULK_JOB_LIST_UNHANDLED",
      stage: "list.unhandled",
      message: "Bulk 작업 조회 중 서버 오류가 발생했습니다.",
      detail: error,
    });
  }
}

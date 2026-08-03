import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  isOpsLoginTemporarilyDisabled,
  isSameOriginOpsRequest,
  temporaryOpsIdentity,
} from "@/lib/opsLoginBypass";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalErrorDetail } from "@/lib/shoplingPriceModifyBulkError";

export { normalErrorDetail } from "@/lib/shoplingPriceModifyBulkError";

type BulkQueryResult = { data: Array<Record<string, unknown>> | null; error: unknown; count?: number | null };
type BulkSingleResult = { data: Record<string, unknown> | null; error: unknown; count?: number | null };
type BulkAdminQuery = PromiseLike<BulkQueryResult> & {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): BulkAdminQuery;
  update(values: Record<string, unknown>): BulkAdminQuery;
  eq(column: string, value: unknown): BulkAdminQuery;
  gt(column: string, value: unknown): BulkAdminQuery;
  lt(column: string, value: unknown): BulkAdminQuery;
  is(column: string, value: null | boolean): BulkAdminQuery;
  not(column: string, operator: "is", value: null | boolean): BulkAdminQuery;
  in(column: string, values: readonly unknown[]): BulkAdminQuery;
  order(column: string, options: { ascending: boolean }): BulkAdminQuery;
  limit(count: number): BulkAdminQuery;
  range(from: number, to: number): BulkAdminQuery;
  maybeSingle(): Promise<BulkSingleResult>;
};
export type BulkAdmin = {
  rpc(name: string, parameters: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  from(table: string): BulkAdminQuery;
};

async function currentOpsRequestFromHeaders() {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders
    .get("x-forwarded-host")
    ?.split(",", 1)[0]
    ?.trim();
  const host = forwardedHost || requestHeaders.get("host")?.trim();
  if (!host) return null;

  const forwardedProtocol = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim();
  const localHost =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]");
  const protocol = forwardedProtocol || (localHost ? "http" : "https");
  const copiedHeaders = new Headers();
  requestHeaders.forEach((value, key) => copiedHeaders.append(key, value));

  return new Request(`${protocol}://${host}/`, { headers: copiedHeaders });
}

async function normalAdminSession(ownerId: string) {
  try {
    const admin = await createSupabaseAdminClient();
    if (!admin) {
      return {
        response: normalError(
          "Supabase 서버 설정이 필요합니다.",
          503,
          "CONFIGURATION_ERROR",
          "normal.session.admin",
        ),
      };
    }
    return { ownerId, admin: admin as BulkAdmin };
  } catch (error) {
    return {
      response: normalError(
        "관리자 클라이언트를 생성할 수 없습니다.",
        500,
        "ADMIN_CLIENT_FAILED",
        "normal.session.admin",
        error,
      ),
    };
  }
}

export async function normalSession(request?: Request) {
  try {
    if (isOpsLoginTemporarilyDisabled()) {
      const opsRequest = request ?? await currentOpsRequestFromHeaders();
      if (!opsRequest || !isSameOriginOpsRequest(opsRequest)) {
        return {
          response: normalError(
            "Ops Center 화면에서 다시 실행하세요.",
            403,
            "OPS_LOGIN_BYPASS_SAME_ORIGIN_REQUIRED",
            "normal.session.bypass",
          ),
        };
      }
      return normalAdminSession(temporaryOpsIdentity().userId);
    }

    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return {
        response: normalError(
          "Supabase 서버 설정이 필요합니다.",
          503,
          "CONFIGURATION_ERROR",
          "normal.session.auth",
        ),
      };
    }
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      return {
        response: normalError(
          "로그인 세션을 확인할 수 없습니다.",
          401,
          "AUTH_SESSION_FAILED",
          "normal.session.auth",
          error,
        ),
      };
    }
    if (!data.user) {
      return {
        response: normalError(
          "로그인이 필요합니다.",
          401,
          "AUTH_REQUIRED",
          "normal.session.auth",
        ),
      };
    }

    return normalAdminSession(data.user.id);
  } catch (error) {
    return {
      response: normalError(
        "로그인 세션을 확인할 수 없습니다.",
        500,
        "AUTH_SESSION_FAILED",
        "normal.session.auth",
        error,
      ),
    };
  }
}

export async function requireManualShoplingPriceBulkJob(
  admin: BulkAdmin,
  jobId: string,
  ownerId: string,
  stage: string,
) {
  const result = await admin.from("shopling_price_bulk_jobs")
    .select("id,status,automation_mode")
    .eq("id", jobId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (result.error) {
    return { response: normalError("Bulk 작업 조회에 실패했습니다.", 500, "JOB_QUERY_FAILED", `${stage}.job_query`, result.error) };
  }
  if (!result.data) {
    return { response: normalError("작업을 찾을 수 없거나 접근 권한이 없습니다.", 404, "JOB_NOT_FOUND", `${stage}.job_query`) };
  }
  if (result.data.automation_mode === "auto") {
    return {
      response: normalError(
        "이 작업은 서버 자동 실행이 관리합니다. 수동 진행 버튼을 사용하지 마세요.",
        409,
        "AUTO_MANAGED_JOB",
        `${stage}.manual_guard`,
      ),
    };
  }
  return { job: result.data };
}

export function normalError(error: string, status: number, code: string, stage: string, detail?: unknown) {
  return NextResponse.json({ error, code, stage, detail: normalErrorDetail(detail), diagnostic_id: randomUUID() }, { status });
}

export function rpcData(value: unknown): Record<string, unknown> {
  return (Array.isArray(value) ? value[0] : value) as Record<string, unknown>;
}

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalErrorDetail } from "@/lib/shoplingPriceModifyBulkError";

export { normalErrorDetail } from "@/lib/shoplingPriceModifyBulkError";

type BulkQueryResult = { data: Array<Record<string, unknown>> | null; error: unknown; count?: number | null };
type BulkSingleResult = { data: Record<string, unknown> | null; error: unknown; count?: number | null };
type BulkAdminQuery = PromiseLike<BulkQueryResult> & {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): BulkAdminQuery;
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

export async function normalSession() {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return { response: normalError("Supabase 서버 설정이 필요합니다.", 503, "CONFIGURATION_ERROR", "normal.session.auth") };
    const { data, error } = await supabase.auth.getUser();
    if (error) return { response: normalError("로그인 세션을 확인할 수 없습니다.", 401, "AUTH_SESSION_FAILED", "normal.session.auth", error) };
    if (!data.user) return { response: normalError("로그인이 필요합니다.", 401, "AUTH_REQUIRED", "normal.session.auth") };

    try {
      const admin = await createSupabaseAdminClient();
      if (!admin) return { response: normalError("Supabase 서버 설정이 필요합니다.", 503, "CONFIGURATION_ERROR", "normal.session.admin") };
      return { ownerId: data.user.id, admin: admin as BulkAdmin };
    } catch (error) {
      return { response: normalError("관리자 클라이언트를 생성할 수 없습니다.", 500, "ADMIN_CLIENT_FAILED", "normal.session.admin", error) };
    }
  } catch (error) {
    return { response: normalError("로그인 세션을 확인할 수 없습니다.", 500, "AUTH_SESSION_FAILED", "normal.session.auth", error) };
  }
}

export function normalError(error: string, status: number, code: string, stage: string, detail?: unknown) {
  return NextResponse.json({ error, code, stage, detail: normalErrorDetail(detail), diagnostic_id: randomUUID() }, { status });
}

export function rpcData(value: unknown): Record<string, unknown> {
  return (Array.isArray(value) ? value[0] : value) as Record<string, unknown>;
}

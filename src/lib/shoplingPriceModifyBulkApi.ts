import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type BulkAdmin = { rpc(name: string, parameters: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>; from(table: string): any };
export async function normalSession() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { response: normalError("Supabase 서버 설정이 필요합니다.", 503, "CONFIGURATION_ERROR", "normal.session") };
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { response: normalError("로그인이 필요합니다.", 401, "AUTH_REQUIRED", "normal.session") };
  const admin = await createSupabaseAdminClient();
  if (!admin) return { response: normalError("Supabase 서버 설정이 필요합니다.", 503, "CONFIGURATION_ERROR", "normal.session") };
  return { ownerId: data.user.id, admin: admin as BulkAdmin };
}
export function normalError(error: string, status: number, code: string, stage: string, detail?: unknown) {
  return NextResponse.json({ error, code, stage, detail: normalErrorDetail(detail), diagnostic_id: randomUUID() }, { status });
}
export function rpcData(value: unknown): Record<string, unknown> { return (Array.isArray(value) ? value[0] : value) as Record<string, unknown>; }

export function normalErrorDetail(detail: unknown): string | null {
  if (detail == null) return null;
  let text: string;
  if (detail instanceof Error) text = detail.message;
  else if (typeof detail === "string") text = detail;
  else if (typeof detail === "object" && "message" in detail && typeof detail.message === "string") text = detail.message;
  else {
    try { text = JSON.stringify(detail); }
    catch { text = String(detail); }
  }
  return text
    .replace(/sb_secret_[A-Za-z0-9._-]+/gi, "[REDACTED_SUPABASE_SECRET]")
    .replace(/\bBearer\s+[^\s,;"'}]+/gi, "Bearer [REDACTED]")
    .replace(/(["']?(?:apikey|authorization|service[_ -]?role(?:[_ -]?key)?|SUPABASE_SERVICE_ROLE_KEY)["']?\s*[:=]\s*["']?)[^\s,;"'}]+/gi, "$1[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]")
    .slice(0, 1000);
}

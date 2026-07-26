import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Query = { select: (value?: string) => Query; eq: (key: string, value: unknown) => Query; order: (key: string, options?: object) => Query; limit: (value: number) => Query; single: () => Promise<{data: Record<string, unknown> | null; error: {message:string} | null}>; then: PromiseLike<{data: unknown; error: {message:string} | null}>["then"] };
export type BulkDb = { from: (table: string) => Query; rpc: (name: string, args?: Record<string, unknown>) => Promise<{data: unknown; error: {message:string} | null}> };

export async function requireBulkUser() {
  const client = await createSupabaseServerClient();
  if (!client) return { ok: false as const, status: 503, message: "Supabase가 설정되지 않았습니다." };
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return { ok: false as const, status: 401, message: "로그인이 필요합니다." };
  const admin = await createSupabaseAdminClient();
  if (!admin) return { ok: false as const, status: 503, message: "Supabase admin이 설정되지 않았습니다." };
  return { ok: true as const, userId: data.user.id, db: admin as BulkDb };
}

export async function ownedJob(db: BulkDb, userId: string, jobId: string) {
  const { data } = await db.from("shopling_price_bulk_jobs").select("*").eq("id", jobId).eq("owner_id", userId).single();
  return data;
}

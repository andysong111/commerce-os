import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function bulkRpc(name: string, args: Record<string, unknown> = {}) {
  const client = await createSupabaseAdminClient() as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> } | null;
  if (!client) throw new Error("Supabase 관리자 설정이 필요합니다.");
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

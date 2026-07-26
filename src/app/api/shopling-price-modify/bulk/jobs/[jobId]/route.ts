import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Result = { data: unknown; error: unknown; count?: number | null };
type Query = PromiseLike<Result> & {
  select(columns: string, options?: { count: "exact"; head: boolean }): Query;
  eq(column: string, value: unknown): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
  maybeSingle(): Promise<Result>;
};
type Admin = { from(table: string): Query };

const missing = () => NextResponse.json({ error: "작업을 찾을 수 없거나 접근 권한이 없습니다." }, { status: 404 });

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase 서버 설정이 필요합니다." }, { status: 503 });
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const rawAdmin = await createSupabaseAdminClient();
  if (!rawAdmin) return NextResponse.json({ error: "Supabase 서버 설정이 필요합니다." }, { status: 503 });

  const admin = rawAdmin as Admin;
  const { jobId } = await params;
  const jobResult = await admin.from("shopling_price_bulk_jobs")
    .select("id,status,input_source,original_count,valid_count,duplicate_count,invalid_count,canary_size,normal_chunk_size,total_chunk_count,policy_overrides,last_error,created_at,updated_at")
    .eq("id", jobId)
    .eq("owner_id", auth.user.id)
    .maybeSingle();
  if (jobResult.error) return NextResponse.json({ error: "Bulk 작업 조회에 실패했습니다." }, { status: 500 });
  if (!jobResult.data) return missing();

  const [chunks, first, last, pendingItems, succeededItems, failedItems] = await Promise.all([
    admin.from("shopling_price_bulk_chunks")
      .select("chunk_index,chunk_type,goods_key_count,status,request_id,actions_url,result_summary,last_error,started_at,completed_at,updated_at")
      .eq("job_id", jobId)
      .order("chunk_index", { ascending: true }),
    admin.from("shopling_price_bulk_items")
      .select("goods_key,ordinal,status,last_error")
      .eq("job_id", jobId)
      .order("ordinal", { ascending: true })
      .limit(20),
    admin.from("shopling_price_bulk_items")
      .select("goods_key,ordinal,status,last_error")
      .eq("job_id", jobId)
      .order("ordinal", { ascending: false })
      .limit(5),
    admin.from("shopling_price_bulk_items").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "pending"),
    admin.from("shopling_price_bulk_items").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "succeeded"),
    admin.from("shopling_price_bulk_items").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "failed"),
  ]);
  if (chunks.error || first.error || last.error || pendingItems.error || succeededItems.error || failedItems.error) {
    return NextResponse.json({ error: "Bulk 작업 조회에 실패했습니다." }, { status: 500 });
  }

  const keys = (value: unknown) => (Array.isArray(value) ? value : []).map((row) => (row as { goods_key: string }).goods_key);
  const chunkRows = Array.isArray(chunks.data) ? chunks.data as Array<Record<string, unknown>> : [];
  const chunkStatuses = ["pending", "dispatching", "running", "succeeded", "failed", "dispatch_uncertain"];
  const chunkStatusCounts = Object.fromEntries(chunkStatuses.map((status) => [status, chunkRows.filter((row) => row.status === status).length]));
  const normalChunks = chunkRows.filter((row) => row.chunk_type === "normal");
  return NextResponse.json({
    job: jobResult.data,
    chunks: chunks.data ?? [],
    first_goods_keys: keys(first.data),
    last_goods_keys: keys(last.data).reverse(),
    item_status_counts: { pending: pendingItems.count ?? 0, succeeded: succeededItems.count ?? 0, failed: failedItems.count ?? 0 },
    chunk_status_counts: chunkStatusCounts,
    normal_chunk_count: normalChunks.length,
    current_active_chunk: normalChunks.find((row) => ["dispatching", "running", "dispatch_uncertain"].includes(String(row.status))) ?? null,
  });
}

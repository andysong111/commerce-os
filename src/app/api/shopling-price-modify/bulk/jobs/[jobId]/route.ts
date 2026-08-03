import { NextResponse } from "next/server";
import { normalSession } from "@/lib/shoplingPriceModifyBulkApi";

const FAILED_PREVIEW_LIMIT = 100;
const missing = () => NextResponse.json({ error: "작업을 찾을 수 없거나 접근 권한이 없습니다." }, { status: 404 });

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await normalSession(request);
  if (auth.response) return auth.response;

  const { jobId } = await params;
  const jobResult = await auth.admin!.from("shopling_price_bulk_jobs")
    .select("id,status,input_source,original_count,valid_count,duplicate_count,invalid_count,canary_size,normal_chunk_size,total_chunk_count,policy_overrides,last_error,pause_requested,retry_round,max_retry_rounds,retry_resume_status,retry_scope_known,execution_mode,archived_at,automation_mode,automation_started_at,automation_last_tick_at,automation_finished_at,automation_lease_until,automation_worker_id,automation_stop_reason,created_at,updated_at")
    .eq("id", jobId)
    .eq("owner_id", auth.ownerId)
    .maybeSingle();
  if (jobResult.error) return NextResponse.json({ error: "Bulk 작업 조회에 실패했습니다." }, { status: 500 });
  if (!jobResult.data) return missing();

  const [chunks, first, last, failedPreview, pendingItems, succeededItems, failedItems] = await Promise.all([
    auth.admin!.from("shopling_price_bulk_chunks")
      .select("chunk_index,chunk_type,goods_key_count,status,request_id,actions_url,result_summary,last_error,started_at,completed_at,updated_at,retry_round")
      .eq("job_id", jobId)
      .order("chunk_index", { ascending: true }),
    auth.admin!.from("shopling_price_bulk_items")
      .select("goods_key,ordinal,status,last_error")
      .eq("job_id", jobId)
      .order("ordinal", { ascending: true })
      .limit(20),
    auth.admin!.from("shopling_price_bulk_items")
      .select("goods_key,ordinal,status,last_error")
      .eq("job_id", jobId)
      .order("ordinal", { ascending: false })
      .limit(5),
    auth.admin!.from("shopling_price_bulk_items")
      .select("goods_key,ordinal,last_error,attempt_count")
      .eq("job_id", jobId)
      .eq("status", "failed")
      .order("ordinal", { ascending: true })
      .limit(FAILED_PREVIEW_LIMIT),
    auth.admin!.from("shopling_price_bulk_items").select("goods_key", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "pending"),
    auth.admin!.from("shopling_price_bulk_items").select("goods_key", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "succeeded"),
    auth.admin!.from("shopling_price_bulk_items").select("goods_key", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "failed"),
  ]);
  if (chunks.error || first.error || last.error || failedPreview.error || pendingItems.error || succeededItems.error || failedItems.error) {
    return NextResponse.json({ error: "Bulk 작업 조회에 실패했습니다." }, { status: 500 });
  }

  const keys = (value: unknown) => (Array.isArray(value) ? value : []).map((row) => (row as { goods_key: string }).goods_key);
  const chunkRows = Array.isArray(chunks.data) ? chunks.data as Array<Record<string, unknown>> : [];
  const chunkStatuses = ["pending", "dispatching", "running", "succeeded", "failed", "recovered", "superseded", "dispatch_uncertain"];
  const chunkStatusCounts = Object.fromEntries(chunkStatuses.map((status) => [status, chunkRows.filter((row) => row.status === status).length]));
  const normalChunks = chunkRows.filter((row) => row.chunk_type === "normal");
  const retryChunks = chunkRows.filter((row) => row.chunk_type === "retry");
  const retryRound = Number((jobResult.data as Record<string, unknown>).retry_round ?? 0);
  const failedRows = Array.isArray(failedPreview.data) ? failedPreview.data : [];
  const failedCount = failedItems.count ?? 0;

  return NextResponse.json({
    job: jobResult.data,
    chunks: chunks.data ?? [],
    first_goods_keys: keys(first.data),
    last_goods_keys: keys(last.data).reverse(),
    item_status_counts: { pending: pendingItems.count ?? 0, succeeded: succeededItems.count ?? 0, failed: failedItems.count ?? 0 },
    chunk_status_counts: chunkStatusCounts,
    normal_chunk_count: normalChunks.length,
    retry_chunk_count: retryChunks.length,
    current_retry_round_chunk_count: retryChunks.filter((row) => Number(row.retry_round) === retryRound).length,
    recovered_chunk_count: chunkRows.filter((row) => row.status === "recovered").length,
    superseded_chunk_count: chunkRows.filter((row) => row.status === "superseded").length,
    failed_goods_key_count: failedCount,
    failed_goods_keys_preview: keys(failedRows),
    failed_items_preview: failedRows,
    failed_preview_limit: FAILED_PREVIEW_LIMIT,
    failed_preview_truncated: failedCount > FAILED_PREVIEW_LIMIT,
    current_active_chunk: chunkRows.find((row) => ["dispatching", "running", "dispatch_uncertain"].includes(String(row.status))) ?? null,
  });
}

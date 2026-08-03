import { NextResponse } from "next/server";
import { normalSession } from "@/lib/shoplingPriceModifyBulkApi";
import { buildShoplingPriceBulkHealth } from "@/lib/shoplingPriceModifyBulkHealth";

export const runtime = "nodejs";

const missing = () => NextResponse.json({ error: "작업을 찾을 수 없거나 접근 권한이 없습니다." }, { status: 404 });

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await normalSession(request);
  if (auth.response) return auth.response;

  const { jobId } = await params;
  const jobResult = await auth.admin!.from("shopling_price_bulk_jobs")
    .select("id,status,valid_count,duplicate_count,invalid_count,canary_size,normal_chunk_size,total_chunk_count,last_error,pause_requested,retry_round,max_retry_rounds,retry_scope_known,execution_mode,archived_at,automation_mode,automation_started_at,automation_last_tick_at,automation_finished_at,automation_lease_until,automation_worker_id,automation_stop_reason,created_at,updated_at")
    .eq("id", jobId)
    .eq("owner_id", auth.ownerId)
    .maybeSingle();
  if (jobResult.error) return NextResponse.json({ error: "작업 진단정보를 불러오지 못했습니다." }, { status: 500 });
  if (!jobResult.data) return missing();

  const [chunksResult, pendingItems, succeededItems, failedItems] = await Promise.all([
    auth.admin!.from("shopling_price_bulk_chunks")
      .select("chunk_index,chunk_type,goods_key_count,status,request_id,actions_url,last_error,started_at,completed_at,updated_at,retry_round")
      .eq("job_id", jobId)
      .order("chunk_index", { ascending: true }),
    auth.admin!.from("shopling_price_bulk_items").select("goods_key", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "pending"),
    auth.admin!.from("shopling_price_bulk_items").select("goods_key", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "succeeded"),
    auth.admin!.from("shopling_price_bulk_items").select("goods_key", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "failed"),
  ]);
  if (chunksResult.error || pendingItems.error || succeededItems.error || failedItems.error) {
    return NextResponse.json({ error: "작업 진단정보를 불러오지 못했습니다." }, { status: 500 });
  }

  const chunks = Array.isArray(chunksResult.data) ? chunksResult.data as Array<Record<string, unknown>> : [];
  const currentActiveChunk = chunks.find((row) => ["dispatching", "running", "dispatch_uncertain"].includes(String(row.status))) ?? null;
  const health = buildShoplingPriceBulkHealth(jobResult.data, currentActiveChunk, Date.now());
  const completedNormalChunks = chunks.filter((row) => row.chunk_type === "normal" && ["succeeded", "recovered"].includes(String(row.status))).length;
  const normalChunkCount = chunks.filter((row) => row.chunk_type === "normal").length;

  return NextResponse.json({
    captured_at: new Date().toISOString(),
    page_origin: new URL(request.url).origin,
    job: jobResult.data,
    health,
    progress: {
      pending: pendingItems.count ?? 0,
      succeeded: succeededItems.count ?? 0,
      failed: failedItems.count ?? 0,
      completed_normal_chunks: completedNormalChunks,
      normal_chunk_count: normalChunkCount,
    },
    current_active_chunk: currentActiveChunk,
    recent_chunks: chunks.slice(-8),
  });
}

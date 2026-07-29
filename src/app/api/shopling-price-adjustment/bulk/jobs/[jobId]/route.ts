import { NextResponse } from "next/server";
import { requireShoplingPriceAdjustmentAdmin } from "@/lib/shoplingPriceAdjustmentAuth";
import { normalError } from "@/lib/shoplingPriceModifyBulkApi";

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await requireShoplingPriceAdjustmentAdmin(request);
  if (!auth.ok) return auth.response;
  const { jobId } = await params;

  const jobResult = await auth.admin.from("shopling_price_adjustment_bulk_jobs")
    .select("id,status,input_source,original_count,valid_count,duplicate_count,invalid_count,canary_size,chunk_size,total_chunk_count,pause_requested,last_error,created_at,updated_at,completed_at")
    .eq("id", jobId)
    .eq("owner_id", auth.ownerId)
    .maybeSingle();
  if (jobResult.error) return normalError("Bulk 작업 조회에 실패했습니다.", 500, "ADJUSTMENT_BULK_JOB_QUERY_FAILED", "adjustment_bulk.detail.job", jobResult.error);
  if (!jobResult.data) return normalError("작업을 찾을 수 없거나 접근 권한이 없습니다.", 404, "ADJUSTMENT_BULK_JOB_NOT_FOUND", "adjustment_bulk.detail.job");

  const statuses = ["pending", "running", "succeeded", "failed", "not_executed"];
  const [chunks, ...counts] = await Promise.all([
    auth.admin.from("shopling_price_adjustment_bulk_chunks")
      .select("id,chunk_index,chunk_type,goods_key_count,status,plan_request_id,execute_request_id,plan_run_url,execute_run_url,last_error,started_at,completed_at,updated_at")
      .eq("job_id", jobId)
      .order("chunk_index", { ascending: true }),
    ...statuses.map((status) => auth.admin.from("shopling_price_adjustment_bulk_items")
      .select("goods_key", { count: "exact", head: true })
      .eq("job_id", jobId)
      .eq("status", status)),
  ]);
  if (chunks.error || counts.some((result) => result.error)) {
    return normalError("Bulk 진행상황 조회에 실패했습니다.", 500, "ADJUSTMENT_BULK_PROGRESS_QUERY_FAILED", "adjustment_bulk.detail.progress", chunks.error ?? counts.find((result) => result.error)?.error);
  }

  const itemStatusCounts = Object.fromEntries(statuses.map((status, index) => [status, counts[index].count ?? 0]));
  const chunkRows = Array.isArray(chunks.data) ? chunks.data as Array<Record<string, unknown>> : [];
  const chunkStatuses = ["pending", "planning", "ready", "executing", "succeeded", "failed", "dispatch_uncertain"];
  const chunkStatusCounts = Object.fromEntries(chunkStatuses.map((status) => [status, chunkRows.filter((row) => row.status === status).length]));

  return NextResponse.json({
    job: jobResult.data,
    chunks: chunkRows,
    item_status_counts: itemStatusCounts,
    chunk_status_counts: chunkStatusCounts,
    current_chunk: chunkRows.find((row) => ["planning", "ready", "executing", "dispatch_uncertain"].includes(String(row.status)))
      ?? chunkRows.find((row) => row.status === "pending")
      ?? null,
  });
}

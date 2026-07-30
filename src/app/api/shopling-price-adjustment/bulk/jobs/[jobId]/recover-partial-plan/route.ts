import { NextResponse } from "next/server";
import { requireShoplingPriceAdjustmentAdmin } from "@/lib/shoplingPriceAdjustmentAuth";
import { normalError } from "@/lib/shoplingPriceModifyBulkApi";

const PARTIAL_FAILURE_PATTERN = /partial_failure|읽기 전용 계획 검증 실패/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const auth = await requireShoplingPriceAdjustmentAdmin(request);
  if (!auth.ok) return auth.response;
  const { jobId } = await params;

  const jobResult = await auth.admin
    .from("shopling_price_adjustment_bulk_jobs")
    .select("id,status,last_error")
    .eq("id", jobId)
    .eq("owner_id", auth.ownerId)
    .maybeSingle();
  if (jobResult.error) {
    return normalError(
      "복구할 Bulk 작업 조회에 실패했습니다.",
      500,
      "ADJUSTMENT_BULK_RECOVERY_JOB_QUERY_FAILED",
      "adjustment_bulk.recover.job",
      jobResult.error,
    );
  }
  const job = jobResult.data as { id?: string; status?: string; last_error?: string | null } | null;
  if (!job || job.status !== "failed" || !PARTIAL_FAILURE_PATTERN.test(job.last_error ?? "")) {
    return normalError(
      "읽기 전용 계획 일부 실패 작업만 복구할 수 있습니다.",
      409,
      "ADJUSTMENT_BULK_RECOVERY_NOT_ALLOWED",
      "adjustment_bulk.recover.guard",
    );
  }

  const failedChunkResult = await auth.admin
    .from("shopling_price_adjustment_bulk_chunks")
    .select("id,chunk_index,status,last_error,execute_request_id")
    .eq("job_id", jobId)
    .eq("status", "failed")
    .order("chunk_index", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (failedChunkResult.error || !failedChunkResult.data) {
    return normalError(
      "복구할 실패 청크를 찾지 못했습니다.",
      409,
      "ADJUSTMENT_BULK_RECOVERY_CHUNK_NOT_FOUND",
      "adjustment_bulk.recover.chunk",
      failedChunkResult.error,
    );
  }
  const failedChunk = failedChunkResult.data as {
    id: string;
    chunk_index: number;
    last_error?: string | null;
    execute_request_id?: string | null;
  };
  if (
    failedChunk.execute_request_id
    || !PARTIAL_FAILURE_PATTERN.test(failedChunk.last_error ?? "")
  ) {
    return normalError(
      "실제 가격 변경이 시작된 청크는 자동 복구하지 않습니다.",
      409,
      "ADJUSTMENT_BULK_RECOVERY_WRITE_GUARD",
      "adjustment_bulk.recover.guard",
    );
  }

  const failedItems = await auth.admin
    .from("shopling_price_adjustment_bulk_items")
    .select("goods_key", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("status", "failed");
  const runningItems = await auth.admin
    .from("shopling_price_adjustment_bulk_items")
    .select("goods_key", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("status", "running");
  if (failedItems.error || runningItems.error || (failedItems.count ?? 0) > 0 || (runningItems.count ?? 0) > 0) {
    return normalError(
      "실제 실행 실패 또는 실행 중 상품이 있어 자동 복구를 중단했습니다.",
      409,
      "ADJUSTMENT_BULK_RECOVERY_ITEM_GUARD",
      "adjustment_bulk.recover.guard",
      failedItems.error ?? runningItems.error,
    );
  }

  const recoveryNote = `복구 대기: 읽기 전용 계획 일부 실패 청크 #${failedChunk.chunk_index}`;
  const chunkReset = await auth.admin
    .from("shopling_price_adjustment_bulk_chunks")
    .update({
      status: "pending",
      plan_request_id: null,
      execute_request_id: null,
      execution_rows: null,
      plan_summary: null,
      execute_summary: null,
      plan_run_url: null,
      execute_run_url: null,
      completed_at: null,
      last_error: recoveryNote,
      updated_at: new Date().toISOString(),
    })
    .eq("id", failedChunk.id)
    .eq("job_id", jobId)
    .eq("status", "failed")
    .select("id")
    .maybeSingle();
  if (chunkReset.error || !chunkReset.data) {
    return normalError(
      "실패 청크 초기화에 실패했습니다.",
      409,
      "ADJUSTMENT_BULK_RECOVERY_CHUNK_RESET_FAILED",
      "adjustment_bulk.recover.chunk",
      chunkReset.error,
    );
  }

  const itemReset = await auth.admin
    .from("shopling_price_adjustment_bulk_items")
    .update({ status: "pending", result: null, updated_at: new Date().toISOString() })
    .eq("job_id", jobId)
    .eq("status", "not_executed");
  if (itemReset.error) {
    return normalError(
      "미실행 상품 상태 복구에 실패했습니다. 같은 복구 버튼을 다시 누르지 말고 점검이 필요합니다.",
      500,
      "ADJUSTMENT_BULK_RECOVERY_ITEM_RESET_FAILED",
      "adjustment_bulk.recover.items",
      itemReset.error,
    );
  }

  const jobReset = await auth.admin
    .from("shopling_price_adjustment_bulk_jobs")
    .update({
      status: "running",
      pause_requested: false,
      worker_id: null,
      lease_until: null,
      last_error: null,
      completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("owner_id", auth.ownerId)
    .eq("status", "failed")
    .select("id,status")
    .maybeSingle();
  if (jobReset.error || !jobReset.data) {
    return normalError(
      "Bulk 작업 재개 상태 저장에 실패했습니다.",
      500,
      "ADJUSTMENT_BULK_RECOVERY_JOB_RESET_FAILED",
      "adjustment_bulk.recover.job",
      jobReset.error,
    );
  }

  await auth.admin
    .from("shopling_price_adjustment_bulk_chunks")
    .update({ last_error: null, updated_at: new Date().toISOString() })
    .eq("id", failedChunk.id)
    .eq("job_id", jobId)
    .eq("status", "pending");

  return NextResponse.json({
    job: jobReset.data,
    recoveredChunkIndex: failedChunk.chunk_index,
    message: "기존 성공 상품은 유지하고 실패한 조회 청크부터 복구했습니다. 오류 상품은 다음 계획 결과에서 자동 제외됩니다.",
  });
}

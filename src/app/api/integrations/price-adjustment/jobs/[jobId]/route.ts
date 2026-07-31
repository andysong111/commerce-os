import { NextResponse } from "next/server";
import { requirePriceAdjustmentIntegration } from "@/lib/priceAdjustmentIntegrationAuth";
import { advanceShoplingPriceAdjustmentBulkJob } from "@/lib/shoplingPriceAdjustmentBulkOrchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 50;

const ITEM_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "not_executed",
] as const;
const CHUNK_STATUSES = [
  "pending",
  "planning",
  "ready",
  "executing",
  "succeeded",
  "failed",
  "dispatch_uncertain",
] as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const auth = await requirePriceAdjustmentIntegration(request);
  if (!auth.ok) return auth.response;
  const { jobId } = await params;

  let progressMessage: string | null = null;
  try {
    const progress = await advanceShoplingPriceAdjustmentBulkJob(
      auth.admin,
      jobId,
      auth.ownerId,
    );
    progressMessage = progress.message;
  } catch (error) {
    progressMessage =
      error instanceof Error
        ? error.message
        : "가격변경 작업을 진행하지 못했습니다.";
  }

  const jobResult = await auth.admin
    .from("shopling_price_adjustment_bulk_jobs")
    .select(
      "id,status,input_source,original_count,valid_count,duplicate_count,invalid_count,canary_size,chunk_size,total_chunk_count,pause_requested,last_error,created_at,updated_at,completed_at",
    )
    .eq("id", jobId)
    .eq("owner_id", auth.ownerId)
    .maybeSingle();
  if (jobResult.error) {
    return NextResponse.json(
      {
        ok: false,
        code: "PRICE_ADJUSTMENT_JOB_QUERY_FAILED",
        message: "가격변경 작업을 조회하지 못했습니다.",
      },
      { status: 500 },
    );
  }
  if (!jobResult.data) {
    return NextResponse.json(
      {
        ok: false,
        code: "PRICE_ADJUSTMENT_JOB_NOT_FOUND",
        message: "가격변경 작업을 찾지 못했습니다.",
      },
      { status: 404 },
    );
  }

  const [chunks, ...itemCounts] = await Promise.all([
    auth.admin
      .from("shopling_price_adjustment_bulk_chunks")
      .select(
        "id,chunk_index,chunk_type,goods_key_count,status,plan_request_id,execute_request_id,plan_run_url,execute_run_url,last_error,started_at,completed_at,updated_at",
      )
      .eq("job_id", jobId)
      .order("chunk_index", { ascending: true }),
    ...ITEM_STATUSES.map((status) =>
      auth.admin
        .from("shopling_price_adjustment_bulk_items")
        .select("goods_key", { count: "exact", head: true })
        .eq("job_id", jobId)
        .eq("status", status),
    ),
  ]);
  if (chunks.error || itemCounts.some((result) => result.error)) {
    return NextResponse.json(
      {
        ok: false,
        code: "PRICE_ADJUSTMENT_PROGRESS_QUERY_FAILED",
        message: "가격변경 진행상황을 조회하지 못했습니다.",
      },
      { status: 500 },
    );
  }

  const chunkRows = Array.isArray(chunks.data)
    ? (chunks.data as Array<Record<string, unknown>>)
    : [];
  const itemStatusCounts = Object.fromEntries(
    ITEM_STATUSES.map((status, index) => [
      status,
      itemCounts[index].count ?? 0,
    ]),
  );
  const chunkStatusCounts = Object.fromEntries(
    CHUNK_STATUSES.map((status) => [
      status,
      chunkRows.filter((row) => row.status === status).length,
    ]),
  );
  const currentChunk =
    chunkRows.find((row) =>
      ["planning", "ready", "executing", "dispatch_uncertain"].includes(
        String(row.status),
      ),
    ) ??
    chunkRows.find((row) => row.status === "pending") ??
    null;
  const job = jobResult.data as Record<string, unknown>;

  return NextResponse.json({
    ok: true,
    job,
    itemStatusCounts,
    chunkStatusCounts,
    currentChunk,
    progressMessage,
    lastError:
      (typeof job.last_error === "string" && job.last_error) ||
      (chunkRows.find((row) => row.last_error)?.last_error as string | null) ||
      null,
  });
}

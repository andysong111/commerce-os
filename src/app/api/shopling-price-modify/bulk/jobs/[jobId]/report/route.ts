import { NextResponse } from "next/server";
import { normalError, normalSession, type BulkAdmin } from "@/lib/shoplingPriceModifyBulkApi";
import {
  calculateShoplingPriceBulkTiming,
  createShoplingPriceBulkItemsCsv,
  type ShoplingPriceBulkOpsChunk,
  type ShoplingPriceBulkOpsItem,
} from "@/lib/shoplingPriceModifyBulkOps";

export const runtime = "nodejs";
const MAX_ITEMS = 20_000;
const PAGE_SIZE = 1_000;

async function loadItems(admin: BulkAdmin, jobId: string) {
  const items: ShoplingPriceBulkOpsItem[] = [];
  let lastOrdinal = 0;

  while (items.length < MAX_ITEMS) {
    const pageLimit = Math.min(PAGE_SIZE, MAX_ITEMS - items.length);
    let query = admin.from("shopling_price_bulk_items")
      .select("goods_key,ordinal,status,attempt_count,last_error")
      .eq("job_id", jobId);
    if (lastOrdinal > 0) query = query.gt("ordinal", lastOrdinal);
    const result = await query.order("ordinal", { ascending: true }).limit(pageLimit);
    if (result.error) throw result.error;
    const rows = Array.isArray(result.data) ? result.data : [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const goodsKey = typeof row.goods_key === "string" ? row.goods_key : "";
      const ordinal = typeof row.ordinal === "number" ? row.ordinal : Number(row.ordinal);
      if (!goodsKey || !Number.isInteger(ordinal) || ordinal <= lastOrdinal) {
        throw new Error("운영 리포트 상품 정렬 커서가 올바르지 않습니다.");
      }
      items.push({
        goods_key: goodsKey,
        ordinal,
        status: typeof row.status === "string" ? row.status : "unknown",
        attempt_count: Number(row.attempt_count ?? 0),
        last_error: typeof row.last_error === "string" ? row.last_error.slice(0, 1000) : null,
      });
      lastOrdinal = ordinal;
    }
    if (rows.length < pageLimit) break;
  }

  return items;
}

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await normalSession();
  if (auth.response) return auth.response;
  const { jobId } = await params;
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  if (!new Set(["json", "csv"]).has(format)) {
    return normalError("지원하지 않는 리포트 형식입니다.", 400, "REPORT_FORMAT_INVALID", "report.format");
  }

  const jobResult = await auth.admin!.from("shopling_price_bulk_jobs")
    .select("id,owner_id,status,input_source,original_count,valid_count,duplicate_count,invalid_count,canary_size,normal_chunk_size,total_chunk_count,created_at,updated_at,last_error,pause_requested,retry_round,max_retry_rounds,retry_resume_status,retry_scope_known,execution_mode,archived_at,archive_note")
    .eq("id", jobId)
    .eq("owner_id", auth.ownerId)
    .maybeSingle();
  if (jobResult.error) return normalError("운영 리포트 작업 조회에 실패했습니다.", 500, "REPORT_JOB_QUERY_FAILED", "report.job_query", jobResult.error);
  if (!jobResult.data) return normalError("작업을 찾을 수 없거나 접근 권한이 없습니다.", 404, "REPORT_JOB_NOT_FOUND", "report.job_query");

  const chunkResult = await auth.admin!.from("shopling_price_bulk_chunks")
    .select("chunk_index,chunk_type,status,goods_key_count,attempt_count,retry_round,request_id,actions_url,started_at,completed_at,updated_at,last_error")
    .eq("job_id", jobId)
    .order("chunk_index", { ascending: true })
    .limit(1000);
  if (chunkResult.error) return normalError("운영 리포트 청크 조회에 실패했습니다.", 500, "REPORT_CHUNK_QUERY_FAILED", "report.chunk_query", chunkResult.error);

  let items: ShoplingPriceBulkOpsItem[];
  try {
    items = await loadItems(auth.admin!, jobId);
  } catch (error) {
    return normalError("운영 리포트 상품 조회에 실패했습니다.", 500, "REPORT_ITEM_QUERY_FAILED", "report.item_query", error);
  }

  const job = jobResult.data as Record<string, unknown>;
  const chunks = (Array.isArray(chunkResult.data) ? chunkResult.data : []).map((row) => ({
    chunk_index: Number(row.chunk_index),
    chunk_type: typeof row.chunk_type === "string" ? row.chunk_type : "unknown",
    status: typeof row.status === "string" ? row.status : "unknown",
    goods_key_count: Number(row.goods_key_count ?? 0),
    attempt_count: Number(row.attempt_count ?? 0),
    retry_round: Number(row.retry_round ?? 0),
    request_id: typeof row.request_id === "string" ? row.request_id : null,
    actions_url: typeof row.actions_url === "string" ? row.actions_url : null,
    started_at: typeof row.started_at === "string" ? row.started_at : null,
    completed_at: typeof row.completed_at === "string" ? row.completed_at : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
    last_error: typeof row.last_error === "string" ? row.last_error.slice(0, 1000) : null,
  })) as ShoplingPriceBulkOpsChunk[];

  const itemStatusCounts = Object.fromEntries(["pending", "succeeded", "failed"].map((status) => [status, items.filter((item) => item.status === status).length]));
  const chunkStatusCounts = chunks.reduce<Record<string, number>>((counts, chunk) => {
    counts[chunk.status] = (counts[chunk.status] ?? 0) + 1;
    return counts;
  }, {});
  const timing = calculateShoplingPriceBulkTiming(job, chunks, itemStatusCounts.succeeded ?? 0);
  const executionMode = typeof job.execution_mode === "string" ? job.execution_mode : "live";
  const jobStatus = typeof job.status === "string" ? job.status : "unknown";

  if (format === "csv") {
    const csv = createShoplingPriceBulkItemsCsv(jobId, executionMode, jobStatus, items);
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="shopling-price-bulk-${jobId}-items.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  return NextResponse.json({
    report_schema_version: 1,
    generated_at: new Date().toISOString(),
    job: {
      id: job.id,
      status: jobStatus,
      execution_mode: executionMode,
      input_source: job.input_source,
      original_count: job.original_count,
      valid_count: job.valid_count,
      duplicate_count: job.duplicate_count,
      invalid_count: job.invalid_count,
      canary_size: job.canary_size,
      normal_chunk_size: job.normal_chunk_size,
      total_chunk_count: job.total_chunk_count,
      pause_requested: job.pause_requested,
      retry_round: job.retry_round,
      max_retry_rounds: job.max_retry_rounds,
      retry_resume_status: job.retry_resume_status,
      retry_scope_known: job.retry_scope_known,
      created_at: job.created_at,
      updated_at: job.updated_at,
      archived_at: job.archived_at,
      archive_note: job.archive_note,
      last_error: typeof job.last_error === "string" ? job.last_error.slice(0, 1000) : null,
    },
    item_status_counts: itemStatusCounts,
    chunk_status_counts: chunkStatusCounts,
    timing,
    chunks,
    items,
  }, { headers: { "cache-control": "no-store" } });
}

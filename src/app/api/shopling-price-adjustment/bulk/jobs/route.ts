import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { normalError, normalSession, rpcData } from "@/lib/shoplingPriceModifyBulkApi";
import { validateShoplingPriceAdjustmentBulkCreateInput } from "@/lib/shoplingPriceAdjustmentBulkServer";

export async function POST(request: Request) {
  const auth = await normalSession();
  if (auth.response) return auth.response;

  let input;
  try { input = validateShoplingPriceAdjustmentBulkCreateInput(await request.json()); }
  catch (error) {
    return normalError(error instanceof Error ? error.message : "Bulk 입력이 올바르지 않습니다.", 400, "ADJUSTMENT_BULK_INPUT_INVALID", "adjustment_bulk.create.validate", error);
  }

  const existing = await auth.admin.from("shopling_price_adjustment_bulk_jobs")
    .select("id,status")
    .eq("owner_id", auth.ownerId)
    .in("status", ["prepared", "running", "paused", "dispatch_uncertain"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    return normalError(
      "기존 가격 인상·인하 Bulk 작업을 확인하지 못했습니다.",
      500,
      "ADJUSTMENT_BULK_ACTIVE_JOB_QUERY_FAILED",
      "adjustment_bulk.create.active_job",
      existing.error,
    );
  }
  if (existing.data) {
    return NextResponse.json({
      error: "진행 중이거나 확인이 필요한 기존 Bulk 작업이 있습니다. 새 작업을 만들지 않고 기존 작업을 확인하세요.",
      code: "ADJUSTMENT_BULK_ACTIVE_JOB_EXISTS",
      stage: "adjustment_bulk.create.active_job",
      detail: null,
      diagnostic_id: randomUUID(),
      active_job: existing.data,
    }, { status: 409 });
  }

  const result = await auth.admin.rpc("create_shopling_price_adjustment_bulk_job", {
    p_owner_id: auth.ownerId,
    p_input_source: input.inputSource,
    p_rows: input.rows.map((row) => ({ goods_key: row.goodsKey, adjustment_bps: row.adjustmentBps })),
    p_original_count: input.originalCount,
    p_duplicate_count: input.duplicateCount,
    p_invalid_count: input.invalidCount,
  });
  if (result.error || !result.data) {
    return normalError("가격 인상·인하 Bulk 작업 저장에 실패했습니다.", 500, "ADJUSTMENT_BULK_CREATE_FAILED", "adjustment_bulk.create.rpc", result.error);
  }
  const job = rpcData(result.data);
  return NextResponse.json({
    id: job.id,
    status: job.status,
    valid_count: job.valid_count,
    canary_size: job.canary_size,
    chunk_size: job.chunk_size,
    total_chunk_count: job.total_chunk_count,
    created_at: job.created_at,
  }, { status: 201 });
}

export async function GET() {
  const auth = await normalSession();
  if (auth.response) return auth.response;
  const [recent, active] = await Promise.all([
    auth.admin.from("shopling_price_adjustment_bulk_jobs")
      .select("id,status,input_source,original_count,valid_count,duplicate_count,invalid_count,canary_size,chunk_size,total_chunk_count,last_error,created_at,updated_at,completed_at")
      .eq("owner_id", auth.ownerId)
      .order("created_at", { ascending: false })
      .limit(10),
    auth.admin.from("shopling_price_adjustment_bulk_jobs")
      .select("id,status,input_source,original_count,valid_count,duplicate_count,invalid_count,canary_size,chunk_size,total_chunk_count,last_error,created_at,updated_at,completed_at")
      .eq("owner_id", auth.ownerId)
      .in("status", ["prepared", "running", "paused", "dispatch_uncertain"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (recent.error || active.error) {
    return normalError(
      "가격 인상·인하 Bulk 작업 조회에 실패했습니다.",
      500,
      "ADJUSTMENT_BULK_LIST_FAILED",
      "adjustment_bulk.list",
      recent.error ?? active.error,
    );
  }
  return NextResponse.json({
    jobs: recent.data ?? [],
    active_job: active.data ?? null,
  });
}

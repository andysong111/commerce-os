import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requirePriceAdjustmentIntegration } from "@/lib/priceAdjustmentIntegrationAuth";
import {
  rpcData,
  type BulkAdmin,
} from "@/lib/shoplingPriceModifyBulkApi";
import { validateShoplingPriceAdjustmentBulkCreateInput } from "@/lib/shoplingPriceAdjustmentBulkServer";
import { advanceShoplingPriceAdjustmentBulkJob } from "@/lib/shoplingPriceAdjustmentBulkOrchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 50;

const ACTIVE_JOB_STATUSES = [
  "prepared",
  "running",
  "paused",
  "dispatch_uncertain",
] as const;

export async function POST(request: Request) {
  const auth = await requirePriceAdjustmentIntegration(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as {
      sourceRunId?: unknown;
      rows?: unknown;
    };
    const sourceRunId = String(body.sourceRunId ?? "").trim();
    if (!sourceRunId || sourceRunId.length > 120) {
      return NextResponse.json(
        {
          ok: false,
          code: "PRICE_ADJUSTMENT_SOURCE_RUN_INVALID",
          message: "가격판정 실행 ID가 올바르지 않습니다.",
        },
        { status: 400 },
      );
    }

    const rawRows = Array.isArray(body.rows) ? body.rows : [];
    const normalizedRows = rawRows.map((entry) => {
      const row = entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : {};
      return {
        goodsKey: String(row.goods_key ?? "").trim(),
        adjustmentBps: Number(row.adjustment_bps),
      };
    });
    const input = validateShoplingPriceAdjustmentBulkCreateInput({
      inputSource: "paste",
      rows: normalizedRows,
      originalCount: rawRows.length,
      duplicateCount: 0,
      invalidCount: 0,
    });

    const existing = await findActiveJob(auth.admin, auth.ownerId);
    if (existing.error) {
      return NextResponse.json(
        {
          ok: false,
          code: "PRICE_ADJUSTMENT_ACTIVE_JOB_QUERY_FAILED",
          message: "기존 가격변경 작업을 확인하지 못했습니다.",
        },
        { status: 500 },
      );
    }
    if (existing.data) {
      return NextResponse.json(
        {
          ok: false,
          code: "PRICE_ADJUSTMENT_ACTIVE_JOB_EXISTS",
          message: "진행 중이거나 확인이 필요한 기존 가격변경 작업이 있습니다.",
          activeJob: existing.data,
        },
        { status: 409 },
      );
    }

    const created = await auth.admin.rpc(
      "create_shopling_price_adjustment_bulk_job",
      {
        p_owner_id: auth.ownerId,
        p_input_source: input.inputSource,
        p_rows: input.rows.map((row) => ({
          goods_key: row.goodsKey,
          adjustment_bps: row.adjustmentBps,
        })),
        p_original_count: input.originalCount,
        p_duplicate_count: input.duplicateCount,
        p_invalid_count: input.invalidCount,
      },
    );
    if (created.error || !created.data) {
      return NextResponse.json(
        {
          ok: false,
          code: "PRICE_ADJUSTMENT_JOB_CREATE_FAILED",
          message: "가격변경 작업 저장에 실패했습니다.",
          diagnosticId: randomUUID(),
        },
        { status: 500 },
      );
    }

    const createdJob = rpcData(created.data);
    const jobId = String(createdJob.id ?? "");
    if (!jobId) {
      return NextResponse.json(
        {
          ok: false,
          code: "PRICE_ADJUSTMENT_JOB_ID_MISSING",
          message: "생성된 가격변경 작업 ID를 확인하지 못했습니다.",
        },
        { status: 500 },
      );
    }

    const started = await auth.admin.rpc(
      "start_shopling_price_adjustment_bulk_job",
      {
        p_job_id: jobId,
        p_owner_id: auth.ownerId,
      },
    );
    if (started.error || !started.data) {
      return NextResponse.json(
        {
          ok: false,
          code: "PRICE_ADJUSTMENT_JOB_START_FAILED",
          message: "가격변경 작업을 시작하지 못했습니다.",
          jobId,
        },
        { status: 409 },
      );
    }

    const progress = await advanceShoplingPriceAdjustmentBulkJob(
      auth.admin,
      jobId,
      auth.ownerId,
      `price-engine-${sourceRunId}`,
    );
    const startedJob = rpcData(started.data);
    return NextResponse.json(
      {
        ok: true,
        jobId,
        sourceRunId,
        status: String(progress.jobStatus || startedJob.status || "running"),
        message: progress.message,
        validCount: Number(createdJob.valid_count || input.rows.length),
        canarySize: Number(createdJob.canary_size || 10),
        chunkSize: Number(createdJob.chunk_size || 50),
        totalChunkCount: Number(createdJob.total_chunk_count || 0),
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "PRICE_ADJUSTMENT_JOB_REQUEST_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "가격변경 작업 요청을 처리하지 못했습니다.",
      },
      { status: 400 },
    );
  }
}

function findActiveJob(admin: BulkAdmin, ownerId: string) {
  return admin
    .from("shopling_price_adjustment_bulk_jobs")
    .select("id,status,created_at,last_error")
    .eq("owner_id", ownerId)
    .in("status", ACTIVE_JOB_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
}

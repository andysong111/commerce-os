import { NextResponse } from "next/server";
import { normalError, normalSession, rpcData } from "@/lib/shoplingPriceModifyBulkApi";
import {
  createShoplingPriceBulkAutoWorkerId,
  releaseShoplingPriceBulkAutoJob,
  runClaimedShoplingPriceBulkAutoJob,
} from "@/lib/shoplingPriceModifyBulkAutoOrchestrator";
import { validateShoplingPriceBulkCreateInput } from "@/lib/shoplingPriceModifyBulkServer";

export const runtime = "nodejs";
export const maxDuration = 50;

const CONFIRMATION = "CONFIRM_ONE_CLICK_AUTO_PRICE_CHANGE";
const LEASE_SECONDS = 75;

function isActiveAutoConflict(value: unknown) {
  let message = "";
  try {
    message = typeof value === "string" ? value : JSON.stringify(value ?? "");
  } catch {
    message = String(value ?? "");
  }
  return /shopling_price_bulk_jobs_owner_active_auto_unique|duplicate key/i.test(message);
}

export async function POST(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return normalError(
      "쉬운 자동 가격 변경은 Production에서만 실행할 수 있습니다.",
      403,
      "AUTO_PRODUCTION_ONLY",
      "auto.create.environment",
    );
  }

  const auth = await normalSession();
  if (auth.response) return auth.response;
  if (!process.env.CRON_SECRET?.trim()) {
    return normalError(
      "자동 실행 서버 설정이 아직 완료되지 않았습니다. 관리자에게 CRON_SECRET 설정을 요청하세요.",
      503,
      "AUTO_CRON_CONFIG_MISSING",
      "auto.create.configuration",
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch (error) {
    return normalError("입력 내용을 읽을 수 없습니다.", 400, "AUTO_INPUT_JSON_INVALID", "auto.create.parse", error);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return normalError("입력 내용이 올바르지 않습니다.", 400, "AUTO_INPUT_INVALID", "auto.create.validate");
  }
  if ((raw as Record<string, unknown>).confirmation !== CONFIRMATION) {
    return normalError("실제 가격 변경 확인이 필요합니다.", 400, "AUTO_CONFIRMATION_REQUIRED", "auto.create.confirmation");
  }

  let input;
  try {
    input = validateShoplingPriceBulkCreateInput(raw);
  } catch (error) {
    return normalError(error instanceof Error ? error.message : "입력 통계가 일치하지 않습니다.", 400, "AUTO_INPUT_INVALID", "auto.create.validate", error);
  }

  const created = await auth.admin!.rpc("create_shopling_price_bulk_prepared_job", {
    p_owner_id: auth.ownerId,
    p_input_source: input.inputSource,
    p_goods_keys: input.goodsKeys,
    p_original_count: input.originalCount,
    p_duplicate_count: input.duplicateCount,
    p_invalid_count: input.invalidCount,
  });
  if (created.error || !created.data) {
    return normalError("자동 가격 변경 작업을 만들 수 없습니다.", 500, "AUTO_CREATE_JOB_FAILED", "auto.create.prepared_job", created.error);
  }

  const job = rpcData(created.data);
  const jobId = typeof job.id === "string" ? job.id : "";
  if (!jobId) {
    return normalError("생성된 작업번호를 확인할 수 없습니다.", 500, "AUTO_CREATE_JOB_EMPTY", "auto.create.prepared_job");
  }

  const workerId = createShoplingPriceBulkAutoWorkerId("one-click");
  const enabled = await auth.admin!.rpc("enable_shopling_price_bulk_auto_execution", {
    p_job_id: jobId,
    p_owner_id: auth.ownerId,
    p_worker_id: workerId,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (enabled.error || !enabled.data) {
    const archive = await auth.admin!.rpc("archive_shopling_price_bulk_job", {
      p_job_id: jobId,
      p_owner_id: auth.ownerId,
      p_note: "one-click auto enable failed before any dispatch",
    });
    const conflict = isActiveAutoConflict(enabled.error);
    return normalError(
      conflict
        ? "이미 자동 가격 변경 작업이 진행 중입니다. 기존 작업이 끝난 뒤 다시 시작하세요."
        : "자동 실행을 시작하지 못했습니다. 고급 관리에서 보관된 작업과 서버 설정을 확인하세요.",
      conflict ? 409 : 500,
      conflict ? "AUTO_JOB_ALREADY_ACTIVE" : "AUTO_ENABLE_FAILED",
      "auto.create.enable",
      { job_id: jobId, error: enabled.error, cleanup_archived: !archive.error },
    );
  }

  const run = await runClaimedShoplingPriceBulkAutoJob(auth.admin!, {
    jobId,
    ownerId: auth.ownerId,
    workerId,
    maxTransitions: 1,
  });

  let leaseWarning: string | null = null;
  if (!run.leaseReleased) {
    try {
      await releaseShoplingPriceBulkAutoJob(auth.admin!, jobId, workerId);
    } catch (error) {
      leaseWarning = error instanceof Error ? error.message : "자동 실행 잠금은 만료 후 복구됩니다.";
    }
  }

  return NextResponse.json({
    id: jobId,
    status: run.status ?? job.status,
    automation_mode: "auto",
    valid_count: job.valid_count,
    total_chunk_count: job.total_chunk_count,
    canary_size: job.canary_size,
    normal_chunk_count: Math.max(0, Number(job.total_chunk_count ?? 1) - 1),
    outcome: run.outcome,
    message: run.message,
    lease_warning: leaseWarning,
  }, { status: 201 });
}

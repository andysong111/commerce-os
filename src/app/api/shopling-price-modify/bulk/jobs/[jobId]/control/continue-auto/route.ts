import { NextResponse } from "next/server";
import { normalError, normalSession, rpcData } from "@/lib/shoplingPriceModifyBulkApi";

export const runtime = "nodejs";

const CONFIRMATION = "CONFIRM_AUTO_CONTINUE_AFTER_REVIEW";
const ACTIVE_CHUNK_STATUSES = ["dispatching", "running", "dispatch_uncertain"];
const CONTINUABLE_STATUSES = new Set([
  "canary_succeeded",
  "normal_running",
  "retry_running",
  "normal_paused",
  "retry_paused",
]);

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  if (process.env.VERCEL_ENV !== "production") {
    return normalError(
      "자동 가격 변경 재개는 Production에서만 실행할 수 있습니다.",
      403,
      "AUTO_CONTINUE_PRODUCTION_ONLY",
      "auto.continue.environment",
    );
  }
  if (!process.env.CRON_SECRET?.trim()) {
    return normalError(
      "자동 실행 서버 설정이 완료되지 않았습니다.",
      503,
      "AUTO_CRON_CONFIG_MISSING",
      "auto.continue.configuration",
    );
  }

  const auth = await normalSession();
  if (auth.response) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return normalError("확인 문구가 필요합니다.", 400, "INVALID_BODY", "auto.continue.body");
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || (body as { confirmation?: unknown }).confirmation !== CONFIRMATION) {
    return normalError("재개 확인 문구가 일치하지 않습니다.", 400, "CONFIRMATION_REQUIRED", "auto.continue.confirmation");
  }

  const { jobId } = await params;
  const jobResult = await auth.admin!.from("shopling_price_bulk_jobs")
    .select("id,status,automation_mode,automation_stop_reason,automation_finished_at,archived_at,pause_requested")
    .eq("id", jobId)
    .eq("owner_id", auth.ownerId)
    .maybeSingle();
  if (jobResult.error) return normalError("작업을 확인할 수 없습니다.", 500, "JOB_QUERY_FAILED", "auto.continue.job_query", jobResult.error);
  if (!jobResult.data) return normalError("작업을 찾을 수 없거나 접근 권한이 없습니다.", 404, "JOB_NOT_FOUND", "auto.continue.job_query");

  const job = jobResult.data as Record<string, unknown>;
  const status = typeof job.status === "string" ? job.status : "";
  if (job.automation_mode !== "auto") {
    return normalError("서버 자동 실행 작업만 이 버튼으로 계속할 수 있습니다.", 409, "AUTO_JOB_REQUIRED", "auto.continue.job_state");
  }
  if (job.archived_at || job.automation_finished_at) {
    return normalError("보관되었거나 이미 완료된 작업입니다.", 409, "AUTO_JOB_NOT_CONTINUABLE", "auto.continue.job_state");
  }
  if (typeof job.automation_stop_reason !== "string" || !job.automation_stop_reason.trim()) {
    return normalError("확인이 필요한 중단 사유가 없습니다.", 409, "AUTO_STOP_REASON_REQUIRED", "auto.continue.job_state");
  }
  if (!CONTINUABLE_STATUSES.has(status)) {
    return normalError("현재 상태에서는 자동 실행을 계속할 수 없습니다.", 409, "AUTO_CONTINUE_STATUS_INVALID", "auto.continue.job_state");
  }

  const activeResult = await auth.admin!.from("shopling_price_bulk_chunks")
    .select("chunk_index,status,request_id")
    .eq("job_id", jobId)
    .in("status", ACTIVE_CHUNK_STATUSES)
    .order("chunk_index", { ascending: true })
    .limit(1);
  if (activeResult.error) return normalError("현재 실행 상태를 확인할 수 없습니다.", 500, "ACTIVE_CHUNK_QUERY_FAILED", "auto.continue.active_chunk", activeResult.error);
  if (Array.isArray(activeResult.data) && activeResult.data.length > 0) {
    return normalError(
      "현재 요청의 결과를 확인 중입니다. 결과 저장이 끝난 뒤 다시 시도하세요.",
      409,
      "ACTIVE_CHUNK_EXISTS",
      "auto.continue.active_chunk",
    );
  }

  if (["normal_paused", "retry_paused"].includes(status)) {
    const resumed = await auth.admin!.rpc("resume_shopling_price_bulk_execution", {
      p_job_id: jobId,
      p_owner_id: auth.ownerId,
    });
    if (resumed.error || !resumed.data) {
      return normalError("일시중지 상태를 해제하지 못했습니다.", 409, "PAUSED_JOB_RESUME_FAILED", "auto.continue.resume_paused", resumed.error);
    }
  }

  const continued = await auth.admin!.rpc("resume_shopling_price_bulk_auto_execution", {
    p_job_id: jobId,
    p_owner_id: auth.ownerId,
  });
  if (continued.error || !continued.data) {
    return normalError(
      "자동 실행을 다시 연결하지 못했습니다. 같은 버튼을 다시 눌러도 이미 성공한 상품은 재실행되지 않습니다.",
      409,
      "AUTO_CONTINUE_REJECTED",
      "auto.continue.rpc",
      continued.error,
    );
  }

  return NextResponse.json({
    ...rpcData(continued.data),
    message: "확인된 결과 다음부터 자동 가격 변경을 계속합니다. 이미 성공한 상품은 다시 실행하지 않습니다.",
  });
}

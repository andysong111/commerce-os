import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  createDetailPageJobToken,
  getDetailPageJobConfig,
  listRecoverableDetailPageJobs,
  listStoppedDetailPageJobsForAssetRepair,
  patchDetailPageJob,
} from "@/lib/detailPageJobServer";
import {
  detailPageRecoveryDecision,
  restoreManualRegenerationAssetsOnFailure,
} from "@/lib/detailPageJobRecovery";
import {
  buildProtectedOpsCallbackUrl,
  resolveDetailPageStudioConnection,
} from "@/lib/detailPageStudioConnection";
import { isDetailPageTestJob } from "@/lib/detailPageTestStudio";

export const runtime = "nodejs";
export const maxDuration = 50;

const RECOVERY_AFTER_MS = 8 * 60 * 1000;
const MAX_RECOVERY_JOBS = 10;

function authorized(request: Request, secret: string) {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function GET(request: Request) {
  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json({ error: "상세페이지 자동복구는 Production에서만 실행됩니다." }, { status: 403 });
  }
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET 설정이 없어 자동복구를 차단했습니다." }, { status: 503 });
  }
  if (!authorized(request, secret)) {
    return NextResponse.json({ error: "자동복구 인증에 실패했습니다." }, { status: 401 });
  }
  const config = getDetailPageJobConfig();
  if (!config.ok) return NextResponse.json(config.body, { status: config.status });
  const connection = resolveDetailPageStudioConnection();
  const stoppedJobs = await listStoppedDetailPageJobsForAssetRepair(
    config.value,
    MAX_RECOVERY_JOBS,
  );
  let repaired = 0;
  for (const job of stoppedJobs) {
    const repair = restoreManualRegenerationAssetsOnFailure(job.result);
    const repairedAt = new Date().toISOString();
    await patchDetailPageJob(config.value, job.id, {
      payload: { recovery_assets_repaired_at: repairedAt },
      ...(Object.keys(repair).length ? { result: repair } : {}),
    });
    if (Object.keys(repair).length) repaired += 1;
    console.info("[detail-page-cron] checked stopped asset restoration", {
      jobId: job.id,
      repaired: Object.keys(repair).length > 0,
    });
  }
  const allRecoverableJobs = await listRecoverableDetailPageJobs(config.value, 50);
  const jobs = allRecoverableJobs.filter(
    (job) => !isDetailPageTestJob(job.payload),
  );
  const skippedTestJobs = allRecoverableJobs.length - jobs.length;
  const now = Date.now();
  const stale = jobs
    .filter((job) => now - Date.parse(job.updated_at || job.created_at) >= RECOVERY_AFTER_MS)
    .slice(0, MAX_RECOVERY_JOBS);
  const results = [];
  for (const job of stale) {
    const decision = detailPageRecoveryDecision(job);
    if (decision.action === "fail") {
      const stoppedAt = new Date().toISOString();
      await patchDetailPageJob(config.value, job.id, {
        status: "failed",
        stage: job.stage || "server_generation",
        message: decision.message,
        qa_status: "failed",
        payload: {
          recovery_stop_code: decision.code,
          recovery_stopped_at: stoppedAt,
        },
        result: restoreManualRegenerationAssetsOnFailure(job.result),
        lease_owner: "",
        lease_until: null,
        error_message: `${decision.code}: ${decision.message}`,
        completed_at: stoppedAt,
      });
      console.warn("[detail-page-cron] stopped unsafe stale job", {
        jobId: job.id,
        stage: job.stage,
        code: decision.code,
      });
      results.push({
        job_id: job.id,
        accepted: false,
        stopped: true,
        code: decision.code,
      });
      continue;
    }

    const recoveryAt = new Date().toISOString();
    await patchDetailPageJob(config.value, job.id, {
      message: "저장된 체크포인트에서 안전 자동 재개 중",
      payload: {
        auto_recovery_count: decision.nextRecoveryCount,
        auto_recovery_scope: decision.recoveryScope,
        last_auto_recovery_at: recoveryAt,
      },
      updated_at: recoveryAt,
    });
    const callbackUrl = buildProtectedOpsCallbackUrl(
      request.url,
      `/api/product-launch-tracker/detail-page-jobs/${job.id}`,
    );
    try {
      const response = await fetch(connection.workerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...connection.requestHeaders,
        },
        body: JSON.stringify({
          callbackUrl: callbackUrl.toString(),
          workerUrl: connection.workerUrl.toString(),
          executionId: String(job.payload.execution_id ?? "").trim() || undefined,
          token: createDetailPageJobToken(config.value, job.owner_id, job.id),
        }),
        redirect: "manual",
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      console.info("[detail-page-cron] checkpoint redispatch", {
        jobId: job.id,
        stage: job.stage,
        recoveryScope: decision.recoveryScope,
        recoveryCount: decision.nextRecoveryCount,
        accepted: response.ok && body?.ok === true,
      });
      results.push({
        job_id: job.id,
        accepted: response.ok && body?.ok === true,
        status: response.status,
      });
    } catch (error) {
      results.push({
        job_id: job.id,
        accepted: false,
        error: error instanceof Error ? error.message : "worker start failed",
      });
    }
  }
  return NextResponse.json({
    ok: true,
    checked: jobs.length,
    skipped_test_jobs: skippedTestJobs,
    repaired,
    recovered: results.filter((item) => item.accepted).length,
    stopped: results.filter((item) => item.stopped).length,
    results,
  });
}

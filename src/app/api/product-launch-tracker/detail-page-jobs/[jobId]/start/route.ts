import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import {
  createDetailPageJobToken,
  getDetailPageJobConfig,
  isValidDetailPageJobId,
  patchDetailPageJob,
  readDetailPageJob,
  reserveDetailPageJobDispatch,
  resolveDetailPageJobIdentity,
} from "@/lib/detailPageJobServer";
import {
  canReassembleCompletedDetailPageJob,
  isRecoverableServerFinalAssemblyJob,
} from "@/lib/detailPageAiReview";
import {
  buildProtectedOpsCallbackUrl,
  resolveDetailPageStudioConnection,
} from "@/lib/detailPageStudioConnection";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ jobId: string }> },
) {
  const identity = await resolveDetailPageJobIdentity(request);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const config = getDetailPageJobConfig();
  if (!config.ok) return Response.json(config.body, { status: config.status });
  const { jobId } = await context.params;
  if (!isValidDetailPageJobId(jobId)) {
    return Response.json(
      { ok: false, code: "INVALID_DETAIL_PAGE_JOB", message: "작업 ID가 올바르지 않습니다." },
      { status: 400 },
    );
  }
  try {
    const job = await readDetailPageJob(config.value, jobId);
    if (!job || job.owner_id !== identity.value.userId) {
      return Response.json(
        { ok: false, code: "DETAIL_PAGE_JOB_NOT_FOUND", message: "상세페이지 작업을 찾지 못했습니다." },
        { status: 404 },
      );
    }
    const recoverableFinalAssembly = isRecoverableServerFinalAssemblyJob({
      status: job.status,
      stage: job.stage,
      result: job.result,
    });
    const command = (await request.json().catch(() => ({}))) as {
      action?: string;
    };
    const finalAssemblyOnly = command.action === "reassemble_final_only";
    const completedFinalReassembly =
      finalAssemblyOnly &&
      canReassembleCompletedDetailPageJob({
        status: job.status,
        result: job.result,
      });
    if (finalAssemblyOnly && !completedFinalReassembly) {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_FINAL_REASSEMBLY_NOT_ALLOWED",
          message:
            "검수 통과 저장 자산이 완전한 완료 작업만 최종 조립을 다시 실행할 수 있습니다.",
        },
        { status: 409 },
      );
    }
    if (
      ["success", "failed", "cancelled"].includes(job.status) &&
      !recoverableFinalAssembly &&
      !completedFinalReassembly
    ) {
      return Response.json({ ok: true, accepted: false, terminal: true, status: job.status });
    }
    let runnableJob = job;
    if (
      (job.status === "failed" && recoverableFinalAssembly) ||
      completedFinalReassembly
    ) {
      const restartedAt = new Date().toISOString();
      const finalizerAttempt =
        Math.max(
          1,
          Math.floor(Number(job.payload.finalizer_attempt) || 1),
        ) + 1;
      const repaired = await patchDetailPageJob(config.value, job.id, {
        status: "render_pending",
        stage: "server_final_assembly",
        message:
          completedFinalReassembly
            ? "검수 통과 저장 자산을 유지하고 최신 템플릿으로 최종 상세페이지만 다시 조립합니다."
            : "기존 검수 통과 자산을 보존하고 서버 최종 조립을 다시 시작합니다.",
        progress: completedFinalReassembly
          ? 95
          : Math.min(99, Math.max(0, Number(job.progress) || 0)),
        qa_status: "passed",
        payload: {
          finalizer_phase: "connecting",
          finalizer_heartbeat_at: restartedAt,
          finalizer_started_at: restartedAt,
          finalizer_attempt: finalizerAttempt,
          finalizer_error_code: "",
        },
        result: {
          standardFailure: null,
          standard_failure: null,
          panelRetrySlots: [],
          panelRetryInstructions: {},
          finalizerMode: "server-v1",
          finalizerPhase: "connecting",
          finalizerStartedAt: restartedAt,
          finalizerErrorCode: "",
        },
        lease_owner: "",
        lease_until: null,
        error_message: "",
        completed_at: null,
      });
      if (!repaired) {
        return Response.json(
          {
            ok: false,
            code: "DETAIL_PAGE_JOB_NOT_FOUND",
            message: "복구할 상세페이지 작업을 찾지 못했습니다.",
          },
          { status: 404 },
        );
      }
      runnableJob = repaired;
    }
    if (
      runnableJob.status !== "render_pending" &&
      (!Array.isArray(runnableJob.payload.evidence_urls) ||
        runnableJob.payload.evidence_urls.length < 1)
    ) {
      return Response.json(
        { ok: false, code: "DETAIL_PAGE_EVIDENCE_NOT_READY", message: "1688 근거 이미지 저장이 완료되지 않았습니다." },
        { status: 409 },
      );
    }
    const connection = resolveDetailPageStudioConnection();
    const dispatchId = randomUUID();
    const reservation = await reserveDetailPageJobDispatch(
      config.value,
      runnableJob.id,
      dispatchId,
    );
    if (!reservation.reserved) {
      console.info("[detail-page-start] duplicate dispatch skipped", {
        jobId: runnableJob.id,
        executionId: String(runnableJob.payload.execution_id ?? ""),
        reason: reservation.reason,
      });
      if (reservation.reason === "missing") {
        return Response.json(
          {
            ok: false,
            code: "DETAIL_PAGE_JOB_NOT_FOUND",
            message: "상세페이지 작업을 찾지 못했습니다.",
          },
          { status: 404 },
        );
      }
      if (reservation.reason === "terminal") {
        return Response.json({
          ok: true,
          accepted: false,
          terminal: true,
          status: reservation.job?.status,
        });
      }
      return Response.json({
        ok: true,
        accepted: false,
        busy: true,
        reason: reservation.reason,
      });
    }
    runnableJob = reservation.job;
    console.info("[detail-page-start] dispatch reserved", {
      jobId: runnableJob.id,
      dispatchId,
      executionId: String(runnableJob.payload.execution_id ?? ""),
    });
    const callbackUrl = buildProtectedOpsCallbackUrl(
      request.url,
      `/api/product-launch-tracker/detail-page-jobs/${job.id}`,
    );
    const response = await fetch(connection.workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...connection.requestHeaders,
      },
      body: JSON.stringify({
        callbackUrl: callbackUrl.toString(),
        workerUrl: connection.workerUrl.toString(),
        executionId: String(runnableJob.payload.execution_id ?? "").trim() || undefined,
        token: createDetailPageJobToken(
          config.value,
          runnableJob.owner_id,
          runnableJob.id,
        ),
      }),
      redirect: "manual",
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_WORKER_START_FAILED",
          message:
            body?.message ||
            (response.status >= 300 && response.status < 400
              ? "Studio Preview 보호 인증이 서버 작업을 차단했습니다."
              : `Studio 서버 작업 시작에 실패했습니다. status=${response.status}`),
        },
        { status: 502 },
      );
    }
    return Response.json({
      ok: true,
      accepted: true,
      workerId: body.workerId,
      dispatchId,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_WORKER_START_FAILED",
        message: error instanceof Error ? error.message : "Studio 서버 작업을 시작하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

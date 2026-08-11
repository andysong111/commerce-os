import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import {
  getDetailPageJobConfig,
  isValidDetailPageJobId,
  patchDetailPageJob,
  publicDetailPageJob,
  readDetailPageJob,
  resolveDetailPageJobIdentity,
} from "@/lib/detailPageJobServer";
import {
  v260807ManualDecisionKind,
  v260807SourceAnchorSnapshot,
} from "@/lib/detailPageManualDecision";
import { DETAIL_PAGE_STAGED_PIPELINE_VERSION } from "@/lib/detailPageJobRecovery";
import { withDetailPageStoreRetry } from "@/lib/detailPageStoreRetry";

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
    const job = await withDetailPageStoreRetry(() =>
      readDetailPageJob(config.value, jobId),
    );
    if (!job || job.owner_id !== identity.value.userId) {
      return Response.json(
        { ok: false, code: "DETAIL_PAGE_JOB_NOT_FOUND", message: "상세페이지 작업을 찾지 못했습니다." },
        { status: 404 },
      );
    }
    const manualJob = {
      status: job.status,
      stage: job.stage,
      error: job.error_message,
      payload: job.payload,
      result: job.result,
    };
    const safetyBlocked =
      v260807ManualDecisionKind(manualJob) === "generation_safety_block";
    const bGradeRetry = isBGradeSourceOnlyFailed(job);
    if (!safetyBlocked && !bGradeRetry) {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_B_GRADE_NOT_ALLOWED",
          message:
            "v260807 AI 이미지 생성 안전검사에서 차단되었거나 B급 원본 조립 자체가 실패한 작업만 B급 원본 조립으로 실행할 수 있습니다.",
        },
        { status: 409 },
      );
    }
    const source = v260807SourceAnchorSnapshot(manualJob);
    if (!source?.evidenceUrls.length) {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_B_GRADE_SOURCE_MISSING",
          message: "B급 원본 조립에 사용할 1688 원본을 확인하지 못했습니다.",
        },
        { status: 409 },
      );
    }

    const decidedAt = new Date().toISOString();
    const executionId = randomUUID();
    const changed = await withDetailPageStoreRetry(() =>
      patchDetailPageJob(config.value, job.id, {
        status: "queued",
        stage: "v3_b_grade_source_only_requested",
        message: bGradeRetry
          ? "사용자 승인 · 기존 1688 원본 유지 · 수정된 B급 원본 조립 재실행 대기 중"
          : "사용자 승인 · B급 원본 조립 대기 중 · AI 이미지 생성 없이 1688 원본만 사용합니다.",
        progress: Math.max(30, Math.min(90, Number(job.progress) || 0)),
        qa_status: "pending",
        payload: {
          attempt: job.attempt + 1,
          assistant_hidden_at: "",
          v3_b_grade_source_only: true,
          v3_b_grade_requested_at: decidedAt,
          manual_review_decision: bGradeRetry
            ? "retry_b_grade_source_only"
            : "run_b_grade_source_only",
          manual_review_decided_at: decidedAt,
          pipeline_version: DETAIL_PAGE_STAGED_PIPELINE_VERSION,
          execution_id: executionId,
          execution_started_at: decidedAt,
          auto_recovery_count: 0,
          auto_recovery_scope: "",
          last_auto_recovery_at: "",
          recovery_stop_code: "",
          recovery_stopped_at: "",
          worker_dispatch_id: "",
          worker_dispatch_execution_id: "",
          worker_dispatch_started_at: "",
          worker_dispatch_until: "",
        },
        result: {
          bGradeEngineRequest: {
            id: "source-only-b-grade-v1",
            qualityTier: "B",
            sourceOnly: true,
            requestedAt: decidedAt,
            trigger: bGradeRetry
              ? "b_grade_source_only_retry"
              : "generation_safety_block",
            anchorIndex: source.anchorIndex,
          },
          v3ManualDecision: {
            decision: bGradeRetry
              ? "retry_b_grade_source_only"
              : "run_b_grade_source_only",
            decidedAt,
            previousStage: job.stage,
            previousError: job.error_message,
          },
        },
        lease_owner: "",
        lease_until: null,
        error_message: "",
        completed_at: null,
      }),
    );
    if (!changed) {
      return Response.json(
        { ok: false, code: "DETAIL_PAGE_JOB_NOT_FOUND", message: "B급으로 전환할 작업을 찾지 못했습니다." },
        { status: 404 },
      );
    }
    return Response.json({ ok: true, job: publicDetailPageJob(changed) });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_B_GRADE_REQUEST_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "B급 원본 조립 전환을 저장하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

function isBGradeSourceOnlyFailed(job: {
  status: string;
  stage: string;
  error_message: string;
}) {
  return (
    job.status === "failed" &&
    job.stage === "v3_b_grade_source_only" &&
    /B_GRADE_SOURCE_ONLY_FAILED/i.test(job.error_message || "")
  );
}

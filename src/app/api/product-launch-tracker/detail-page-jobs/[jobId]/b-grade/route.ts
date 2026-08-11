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
  isV260807DetailPageJob,
  v260807ManualDecisionKind,
  v260807SourceAnchorSnapshot,
} from "@/lib/detailPageManualDecision";
import { DETAIL_PAGE_STAGED_PIPELINE_VERSION } from "@/lib/detailPageJobRecovery";
import { withDetailPageStoreRetry } from "@/lib/detailPageStoreRetry";

const COMPLETED_B_GRADE_RERUN_ACTION = "rerun_completed_b_grade";
const COMPLETED_A_GRADE_TO_B_GRADE_ACTION = "rerun_completed_as_b_grade";

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

  const command = (await request.json().catch(() => ({}))) as {
    action?: string;
  };

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
    const bGradeRetry = isBGradeFailed(job);
    const completedBGradeRerun =
      command.action === COMPLETED_B_GRADE_RERUN_ACTION &&
      isCompletedBGrade(job);
    const completedAGradeConversion =
      command.action === COMPLETED_A_GRADE_TO_B_GRADE_ACTION &&
      isCompletedAGradeEligible(job);
    if (
      !safetyBlocked &&
      !bGradeRetry &&
      !completedBGradeRerun &&
      !completedAGradeConversion
    ) {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_B_GRADE_NOT_ALLOWED",
          message:
            "v260807 A급 AI 이미지 생성이 안전검사에서 차단되었거나, 이전 B급 엔진 실행이 실패·중단되었거나, 검수 통과한 A급/B급 결과를 명시적으로 B급으로 재생성하는 작업만 허용됩니다.",
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
          message: "B급 엔진에 사용할 1688 원본을 확인하지 못했습니다.",
        },
        { status: 409 },
      );
    }

    const decidedAt = new Date().toISOString();
    const executionId = randomUUID();
    const decision = completedBGradeRerun
      ? "rerun_completed_b_grade_source_only"
      : completedAGradeConversion
        ? "rerun_completed_a_grade_as_b_grade"
        : bGradeRetry
          ? "retry_b_grade_source_only"
          : "run_b_grade_source_only";
    const trigger = completedBGradeRerun
      ? "completed_b_grade_rerun"
      : completedAGradeConversion
        ? "completed_a_grade_to_b_grade"
        : bGradeRetry
          ? "b_grade_retry"
          : "generation_safety_block";
    const completedBackup =
      completedBGradeRerun || completedAGradeConversion
        ? completedResultBackup(job)
        : null;
    const completedRerun = completedBGradeRerun || completedAGradeConversion;

    const changed = await withDetailPageStoreRetry(() =>
      patchDetailPageJob(config.value, job.id, {
        status: "queued",
        stage: "v3_b_grade_source_only_requested",
        message: completedBGradeRerun
          ? "사용자 요청 · 기존 B급 검수 통과 결과 보존 · B급 재생성 대기 중"
          : completedAGradeConversion
            ? "사용자 요청 · 기존 A급 검수 통과 결과 보존 · B급 재생성 대기 중"
            : bGradeRetry
              ? "사용자 승인 · 기존 1688 원본 유지 · B급 재실행 대기 중"
              : "사용자 승인 · B급 원본 조립 대기 중",
        progress: completedRerun
          ? 35
          : Math.max(30, Math.min(90, Number(job.progress) || 0)),
        qa_status: "pending",
        payload: {
          attempt: job.attempt + 1,
          assistant_hidden_at: "",
          v3_b_grade_source_only: true,
          v3_b_grade_requested_at: decidedAt,
          manual_review_decision: decision,
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
          ...(completedBackup
            ? { bGradeRerunBackup: completedBackup }
            : {}),
          bGradeEngineRequest: {
            id: "source-only-b-grade-v1",
            qualityTier: "B",
            sourceOnly: true,
            aiImageGeneration: false,
            requestedAt: decidedAt,
            trigger,
            anchorIndex: source.anchorIndex,
          },
          v3ManualDecision: {
            decision,
            decidedAt,
            previousStatus: job.status,
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

function isCompletedAGradeEligible(job: {
  status: string;
  stage: string;
  error_message: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
}) {
  if (job.status !== "success" || isCompletedBGrade(job)) return false;
  const manualJob = {
    status: job.status,
    stage: job.stage,
    error: job.error_message,
    payload: job.payload,
    result: job.result,
  };
  return Boolean(
    isV260807DetailPageJob(manualJob) &&
      v260807SourceAnchorSnapshot(manualJob)?.evidenceUrls.length,
  );
}

function isCompletedBGrade(job: {
  status: string;
  stage: string;
  error_message: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
}) {
  if (job.status !== "success") return false;
  if (
    !isV260807DetailPageJob({
      status: job.status,
      stage: job.stage,
      error: job.error_message,
      payload: job.payload,
      result: job.result,
    })
  ) {
    return false;
  }
  const result = record(job.result);
  const engine = record(result.bGradeEngine);
  const request = record(result.bGradeEngineRequest);
  return (
    engine.id === "source-only-b-grade-v1" ||
    request.id === "source-only-b-grade-v1" ||
    engine.id === "b-grade-hybrid-v2" ||
    request.id === "b-grade-hybrid-v2" ||
    (result.qualityTier === "B" && result.bGradeSourceFirst === true) ||
    (result.qualityTier === "B" && result.bGradeSourceOnly === true) ||
    result.representativeQualityProof === "seller-source-only-no-ai-generation"
  );
}

function completedResultBackup(job: {
  completed_at: string | null;
  result: Record<string, unknown>;
}) {
  const result = record(job.result);
  const engine = record(result.bGradeEngine);
  const request = record(result.bGradeEngineRequest);
  const engineProfile = record(result.engineProfile);
  return {
    detailImageUrl: text(result.detailImageUrl),
    mainImageUrl: text(result.mainImageUrl),
    additionalImageUrls: stringList(result.additionalImageUrls, 4),
    completedAt: job.completed_at ?? "",
    engineId:
      text(engine.id) ||
      text(request.id) ||
      text(engineProfile.id) ||
      (result.bGradeSourceOnly === true
        ? "source-only-b-grade-v1"
        : "source-first-v3"),
    hookAiUsed: result.bGradeHookAiUsed === true,
    hookAiStatus: text(result.bGradeHookAiStatus),
  };
}

function isBGradeFailed(job: {
  status: string;
  stage: string;
  error_message: string;
}) {
  const error = job.error_message || "";
  return (
    job.status === "failed" &&
    ((job.stage === "v3_b_grade_source_only" &&
      /B_GRADE_SOURCE_ONLY_FAILED/i.test(error)) ||
      (job.stage === "v3_b_grade_hybrid" &&
        /B_GRADE_HYBRID_FAILED/i.test(error)) ||
      (["v3_b_grade_source_only", "v3_b_grade_source_only_assembly"].includes(
        job.stage,
      ) && /DETAIL_PAGE_STEP_OUTCOME_UNKNOWN/i.test(error)))
  );
}

function stringList(value: unknown, max: number) {
  return (Array.isArray(value) ? value : [])
    .map(text)
    .filter(Boolean)
    .slice(0, max);
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

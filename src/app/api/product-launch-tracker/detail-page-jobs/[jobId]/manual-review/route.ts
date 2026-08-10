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
  canApproveV260807Identity,
  canResumeV260807Checkpoint,
  isV260807RepresentativeRole,
  v260807IdentitySnapshot,
  v260807ManualDecisionKind,
} from "@/lib/detailPageManualDecision";
import { DETAIL_PAGE_STAGED_PIPELINE_VERSION } from "@/lib/detailPageJobRecovery";

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
    return invalid("작업 ID가 올바르지 않습니다.");
  }

  let body: Record<string, unknown>;
  try {
    body = record(await request.json());
  } catch {
    return invalid("사용자 판단 JSON이 필요합니다.");
  }

  try {
    const job = await readDetailPageJob(config.value, jobId);
    if (!job || job.owner_id !== identity.value.userId) {
      return Response.json(
        {
          ok: false,
          code: "DETAIL_PAGE_JOB_NOT_FOUND",
          message: "상세페이지 작업을 찾지 못했습니다.",
        },
        { status: 404 },
      );
    }

    const action = text(body.action);
    const manualJob = {
      status: job.status,
      stage: job.stage,
      error: job.error_message,
      payload: job.payload,
      result: job.result,
    };
    const kind = v260807ManualDecisionKind(manualJob);
    const decidedAt = new Date().toISOString();

    if (action === "resume_checkpoint") {
      if (kind !== "resume_checkpoint" || !canResumeV260807Checkpoint(manualJob)) {
        return conflict(
          "DETAIL_PAGE_MANUAL_RESUME_NOT_ALLOWED",
          "v260807 자동 복구 한도 소진 작업만 저장 지점에서 계속할 수 있습니다.",
        );
      }
      const changed = await patchDetailPageJob(config.value, job.id, {
        status: "queued",
        stage: "v3_manual_resume_checkpoint",
        message:
          "사용자 판단 · 기존 생성 자산 유지 · 저장된 마지막 단계에서 계속 실행 대기 중",
        progress: clamp(job.progress, 10, 94),
        qa_status: "pending",
        payload: {
          attempt: job.attempt + 1,
          assistant_hidden_at: "",
          manual_review_decision: "resume_checkpoint",
          manual_review_decided_at: decidedAt,
          ...freshExecution(decidedAt),
        },
        result: {
          v3ManualDecision: {
            decision: "resume_checkpoint",
            decidedAt,
            previousStage: job.stage,
            previousError: job.error_message,
          },
        },
        lease_owner: "",
        lease_until: null,
        error_message: "",
        completed_at: null,
      });
      return success(changed ?? job);
    }

    if (kind !== "identity_conflict") {
      return conflict(
        "DETAIL_PAGE_MANUAL_IDENTITY_NOT_ALLOWED",
        "v260807 상품 정체성 충돌 작업에서만 이 판단을 사용할 수 있습니다.",
      );
    }

    const snapshot = v260807IdentitySnapshot(manualJob);
    if (!snapshot) {
      return conflict(
        "DETAIL_PAGE_MANUAL_IDENTITY_CONTEXT_MISSING",
        "상품 정체성 충돌의 기준 원본과 문제 이미지를 확인하지 못했습니다.",
      );
    }

    if (action === "approve_identity") {
      if (!canApproveV260807Identity(manualJob)) {
        return conflict(
          "DETAIL_PAGE_MANUAL_IDENTITY_APPROVAL_NOT_ALLOWED",
          "대표·부가 5장이 모두 저장된 정체성 충돌 작업만 현재 결과를 승인할 수 있습니다.",
        );
      }
      const previousGate = record(job.result.v3RepresentativeIdentityGate);
      const changed = await patchDetailPageJob(config.value, job.id, {
        status: "queued",
        stage: "v3_manual_identity_approved",
        message:
          "사용자 승인 · 현재 대표·부가 이미지를 유지하고 남은 상세 생성·최종 조립 계속 대기 중",
        progress: clamp(job.progress, 10, 94),
        qa_status: "pending",
        payload: {
          attempt: job.attempt + 1,
          assistant_hidden_at: "",
          manual_identity_override: true,
          manual_review_decision: "approve_identity",
          manual_review_decided_at: decidedAt,
          ...freshExecution(decidedAt),
        },
        result: {
          v3RepresentativeIdentityPassed: true,
          v3RepresentativeIdentityGate: {
            ...previousGate,
            previousStatus: previousGate.status,
            status: "manual_override_approved",
            manualOverride: true,
            manualApprovedAt: decidedAt,
          },
          v3ManualDecision: {
            decision: "approve_identity",
            decidedAt,
            failedRoleId: snapshot.failedRoleId,
            anchorIndex: snapshot.anchorIndex,
            reason: snapshot.reason,
          },
        },
        lease_owner: "",
        lease_until: null,
        error_message: "",
        completed_at: null,
      });
      return success(changed ?? job);
    }

    if (action === "regenerate_identity_asset") {
      if (!isV260807RepresentativeRole(snapshot.failedRoleId)) {
        return conflict(
          "DETAIL_PAGE_MANUAL_IDENTITY_ROLE_INVALID",
          "다시 생성할 대표·부가 이미지 역할을 확인하지 못했습니다.",
        );
      }
      const representatives = array(job.result.v3Representatives);
      if (!representatives.some((value) => roleId(value) === snapshot.failedRoleId)) {
        return conflict(
          "DETAIL_PAGE_MANUAL_IDENTITY_ASSET_MISSING",
          "문제로 지목된 저장 이미지를 찾지 못했습니다.",
        );
      }
      const previousGate = record(job.result.v3RepresentativeIdentityGate);
      const changed = await patchDetailPageJob(config.value, job.id, {
        status: "queued",
        stage: "v3_manual_identity_regeneration",
        message:
          "사용자 판단 · 정체성 충돌 문제 이미지 1장만 다시 생성 대기 중",
        progress: clamp(job.progress, 10, 94),
        qa_status: "pending",
        payload: {
          attempt: job.attempt + 1,
          assistant_hidden_at: "",
          manual_review_decision: "regenerate_identity_asset",
          manual_review_decided_at: decidedAt,
          ...freshExecution(decidedAt),
        },
        result: {
          v3Representatives: representatives.filter(
            (value) => roleId(value) !== snapshot.failedRoleId,
          ),
          v3RepresentativeIdentityPassed: false,
          v3RepresentativeIdentityGate: {
            ...previousGate,
            previousStatus: previousGate.status,
            status: "manual_regeneration_requested",
            manualRegenerationRequestedAt: decidedAt,
          },
          v3ManualDecision: {
            decision: "regenerate_identity_asset",
            decidedAt,
            failedRoleId: snapshot.failedRoleId,
            anchorIndex: snapshot.anchorIndex,
          },
        },
        lease_owner: "",
        lease_until: null,
        error_message: "",
        completed_at: null,
      });
      return success(changed ?? job);
    }

    if (action === "change_identity_anchor") {
      const nextAnchorIndex = integer(body.anchorIndex);
      if (
        nextAnchorIndex < 0 ||
        nextAnchorIndex >= snapshot.evidenceUrls.length ||
        nextAnchorIndex === snapshot.anchorIndex
      ) {
        return invalid("변경할 1688 기준 원본 번호가 올바르지 않습니다.");
      }
      const currentPlan = record(job.result.v3Plan);
      if (currentPlan.schema_version !== "detail_page_v3_plan") {
        return conflict(
          "DETAIL_PAGE_MANUAL_IDENTITY_PLAN_MISSING",
          "v260807 상세페이지 계획을 찾지 못했습니다.",
        );
      }
      const previousGate = record(job.result.v3RepresentativeIdentityGate);
      const changed = await patchDetailPageJob(config.value, job.id, {
        status: "queued",
        stage: "v3_manual_identity_anchor_changed",
        message:
          `사용자 판단 · 기준 원본 ${snapshot.anchorIndex + 1}번 → ${nextAnchorIndex + 1}번 변경 · 기존 자산 재검수 대기 중`,
        progress: clamp(job.progress, 10, 94),
        qa_status: "pending",
        payload: {
          attempt: job.attempt + 1,
          assistant_hidden_at: "",
          manual_review_decision: "change_identity_anchor",
          manual_review_decided_at: decidedAt,
          ...freshExecution(decidedAt),
        },
        result: {
          v3Plan: {
            ...currentPlan,
            identity_anchor_index: nextAnchorIndex,
          },
          v3RepresentativeIdentityPassed: false,
          v3RepresentativeIdentityRetries: {},
          v3RepresentativeIdentityGate: {
            ...previousGate,
            previousStatus: previousGate.status,
            status: "manual_anchor_changed",
            previousAnchorIndex: snapshot.anchorIndex,
            anchorIndex: nextAnchorIndex,
            manualAnchorChangedAt: decidedAt,
          },
          v3ManualDecision: {
            decision: "change_identity_anchor",
            decidedAt,
            failedRoleId: snapshot.failedRoleId,
            previousAnchorIndex: snapshot.anchorIndex,
            anchorIndex: nextAnchorIndex,
          },
        },
        lease_owner: "",
        lease_until: null,
        error_message: "",
        completed_at: null,
      });
      return success(changed ?? job);
    }

    return invalid("지원하지 않는 사용자 판단입니다.");
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_MANUAL_REVIEW_FAILED",
        message:
          error instanceof Error
            ? error.message
            : "사용자 판단을 저장하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}

function freshExecution(startedAt: string) {
  return {
    pipeline_version: DETAIL_PAGE_STAGED_PIPELINE_VERSION,
    execution_id: randomUUID(),
    execution_started_at: startedAt,
    auto_recovery_count: 0,
    auto_recovery_scope: "",
    last_auto_recovery_at: "",
    recovery_stop_code: "",
    recovery_stopped_at: "",
    worker_dispatch_id: "",
    worker_dispatch_execution_id: "",
    worker_dispatch_started_at: "",
    worker_dispatch_until: "",
  };
}

function success(job: Parameters<typeof publicDetailPageJob>[0]) {
  return Response.json({ ok: true, job: publicDetailPageJob(job) });
}

function invalid(message: string) {
  return Response.json(
    { ok: false, code: "INVALID_DETAIL_PAGE_MANUAL_REVIEW", message },
    { status: 400 },
  );
}

function conflict(code: string, message: string) {
  return Response.json({ ok: false, code, message }, { status: 409 });
}

function clamp(value: number, min: number, max: number) {
  const normalized = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(normalized) ? normalized : min));
}

function integer(value: unknown) {
  const normalized = Number(value);
  return Number.isInteger(normalized) ? normalized : -1;
}

function roleId(value: unknown) {
  const item = record(value);
  return text(item.roleId || item.role_id);
}

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

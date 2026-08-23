import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { redactReliabilityText } from "@/lib/reliability/reliabilityEvent";

export type ReliabilityAutoImprovementJob = {
  id: string;
  improvement_id: string;
  source_system: string;
  engine: string;
  error_code: string | null;
  target_repo: string;
  safe_surface: string | null;
  mode: "auto" | "approval" | "blocked";
  risk_level: "low" | "medium" | "high" | "critical";
  status: string;
  allowed_paths: string[];
  plan: Record<string, unknown>;
  validation: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
  lease_token: string;
  improvement: Record<string, unknown>;
};

export type ReliabilityAutoImprovementReport = {
  jobId: string;
  leaseToken: string;
  status:
    | "patch_created"
    | "validating"
    | "preview_passed"
    | "merged"
    | "production_verified"
    | "failed"
    | "rolled_back";
  branchName?: string;
  prNumber?: number;
  headSha?: string;
  mergeSha?: string;
  previewUrl?: string;
  productionUrl?: string;
  validation?: Record<string, unknown>;
  error?: string;
};

type AdminClient = NonNullable<Awaited<ReturnType<typeof createSupabaseAdminClient>>>;

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function normalizeJob(value: unknown): ReliabilityAutoImprovementJob {
  const row = object(value);
  const required = ["id", "improvement_id", "target_repo", "lease_token"] as const;
  for (const key of required) {
    if (!String(row[key] ?? "").trim()) {
      throw new Error(`자동개선 작업의 ${key} 값이 비어 있습니다.`);
    }
  }
  return {
    id: String(row.id),
    improvement_id: String(row.improvement_id),
    source_system: String(row.source_system ?? ""),
    engine: String(row.engine ?? ""),
    error_code: row.error_code == null ? null : String(row.error_code),
    target_repo: String(row.target_repo),
    safe_surface: row.safe_surface == null ? null : String(row.safe_surface),
    mode: String(row.mode) as ReliabilityAutoImprovementJob["mode"],
    risk_level: String(row.risk_level) as ReliabilityAutoImprovementJob["risk_level"],
    status: String(row.status ?? "planning"),
    allowed_paths: stringArray(row.allowed_paths),
    plan: object(row.plan),
    validation: object(row.validation),
    attempt_count: Number(row.attempt_count ?? 0),
    max_attempts: Number(row.max_attempts ?? 3),
    lease_token: String(row.lease_token),
    improvement: object(row.improvement),
  };
}

async function adminClient() {
  const admin = await createSupabaseAdminClient();
  if (!admin) throw new Error("OPS CENTER Supabase 관리자 연결이 설정되지 않았습니다.");
  return admin;
}

async function rpc(
  admin: AdminClient,
  name: string,
  parameters: Record<string, unknown>,
) {
  const result = await admin.rpc(name, parameters);
  if (result.error) throw new Error(`${name} 실행에 실패했습니다: ${result.error.message}`);
  return result.data;
}

async function recordActivity(
  admin: AdminClient,
  input: {
    jobId: string;
    eventType: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    summary: string;
    metadata?: Record<string, unknown>;
  },
) {
  await rpc(admin, "record_reliability_auto_improvement_activity", {
    p_job_id: input.jobId,
    p_event_type: input.eventType,
    p_from_status: input.fromStatus ?? null,
    p_to_status: input.toStatus ?? null,
    p_summary: input.summary,
    p_metadata: input.metadata ?? {},
  });
}

export async function claimReliabilityAutoImprovementJob(
  repository: string,
  runner: string,
) {
  const admin = await adminClient();
  await rpc(admin, "requeue_expired_reliability_auto_improvement_jobs", {});
  const result = await admin.rpc("claim_reliability_auto_improvement_job", {
    p_target_repo: repository,
    p_runner: runner,
  });
  if (result.error) {
    throw new Error(`자동개선 작업을 가져오지 못했습니다: ${result.error.message}`);
  }
  if (!result.data) return null;
  return normalizeJob(result.data);
}

export async function saveReliabilityAutoImprovementPlan(input: {
  job: ReliabilityAutoImprovementJob;
  plan: Record<string, unknown>;
}) {
  const admin = await adminClient();
  const saved = await rpc(admin, "save_reliability_auto_improvement_plan", {
    p_job_id: input.job.id,
    p_lease_token: input.job.lease_token,
    p_plan: input.plan,
  });
  if (saved !== true) {
    throw new Error("자동개선 계획을 안전하게 고정하지 못했습니다.");
  }
}

async function markRegressionApplied(input: {
  improvementId: string;
  targetRepo: string;
  mergeSha: string;
  validation: Record<string, unknown>;
}) {
  const admin = await adminClient();
  const testPath = String(input.validation.test_path ?? "").slice(0, 500);
  const testName = String(
    input.validation.test_name ?? "자동개선 재발 방지 확인",
  ).slice(0, 500);
  const result = await rpc(admin, "finalize_reliability_auto_improvement_regression", {
    p_improvement_id: input.improvementId,
    p_target_repo: input.targetRepo,
    p_merge_sha: input.mergeSha,
    p_test_path: testPath,
    p_test_name: testName,
    p_validation: input.validation,
  });
  if (!result) throw new Error("자동개선 GitHub 반영 근거를 저장하지 못했습니다.");
}

async function markRegressionRolledBack(improvementId: string) {
  const admin = await adminClient();
  await rpc(admin, "mark_reliability_auto_improvement_regression_failed", {
    p_improvement_id: improvementId,
  });
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  ready: ["patch_created", "failed"],
  patch_created: ["validating", "failed"],
  validating: ["preview_passed", "failed"],
  preview_passed: ["merged", "failed"],
  merged: ["production_verified", "rolled_back", "failed"],
};

export async function reportReliabilityAutoImprovement(
  repository: string,
  input: ReliabilityAutoImprovementReport,
) {
  const admin = await adminClient();
  const currentResult = await admin
    .from("reliability_auto_improvement_jobs")
    .select("*")
    .eq("id", input.jobId)
    .eq("target_repo", repository)
    .eq("lease_token", input.leaseToken)
    .maybeSingle();
  if (currentResult.error || !currentResult.data) {
    throw new Error("자동개선 작업 또는 실행 권한을 찾지 못했습니다.");
  }
  const current = object(currentResult.data);
  const currentStatus = String(current.status ?? "");
  if (!(ALLOWED_TRANSITIONS[currentStatus] ?? []).includes(input.status)) {
    throw new Error(`허용되지 않는 자동개선 상태 변경입니다: ${currentStatus} → ${input.status}`);
  }

  const terminalFailure = input.status === "failed";
  const attemptCount = Number(current.attempt_count ?? 0);
  const maxAttempts = Number(current.max_attempts ?? 3);
  const storedStatus =
    terminalFailure && attemptCount >= maxAttempts ? "blocked" : input.status;
  const update: Record<string, unknown> = {
    status: storedStatus,
    updated_at: new Date().toISOString(),
  };
  if (input.branchName) update.branch_name = input.branchName.slice(0, 300);
  if (input.prNumber && Number.isInteger(input.prNumber)) update.pr_number = input.prNumber;
  if (input.headSha) update.head_sha = input.headSha.slice(0, 80);
  if (input.mergeSha) update.merge_sha = input.mergeSha.slice(0, 80);
  if (input.previewUrl) update.preview_url = input.previewUrl.slice(0, 1_000);
  if (input.productionUrl) update.production_url = input.productionUrl.slice(0, 1_000);
  if (input.validation) update.validation = input.validation;
  if (input.error) update.last_error = redactReliabilityText(input.error, 1_500);
  if (terminalFailure) {
    update.not_before = new Date(Date.now() + 30 * 60_000).toISOString();
    update.lease_token = null;
    update.lease_runner = null;
    update.lease_expires_at = null;
  }
  if (["production_verified", "rolled_back"].includes(input.status)) {
    update.lease_token = null;
    update.lease_runner = null;
    update.lease_expires_at = null;
  }

  const updated = await admin
    .from("reliability_auto_improvement_jobs")
    .update(update)
    .eq("id", input.jobId)
    .eq("lease_token", input.leaseToken)
    .select("id,improvement_id,target_repo,validation")
    .maybeSingle();
  if (updated.error || !updated.data) {
    throw new Error("자동개선 진행 상태를 저장하지 못했습니다.");
  }
  const updatedRow = object(updated.data);

  await recordActivity(admin, {
    jobId: input.jobId,
    eventType: input.status,
    fromStatus: currentStatus,
    toStatus: storedStatus,
    summary:
      input.status === "production_verified"
        ? "테스트와 미리보기를 통과한 수정이 실제 서비스에 반영됐습니다."
        : input.status === "rolled_back"
          ? "운영 검증 실패로 자동으로 이전 상태로 되돌렸습니다."
          : input.status === "failed"
            ? "안전 검증을 통과하지 못해 실제 서비스에는 반영하지 않았습니다."
            : "자동개선 다음 단계를 통과했습니다.",
    metadata: {
      prNumber: input.prNumber ?? null,
      headSha: input.headSha ?? null,
      mergeSha: input.mergeSha ?? null,
    },
  });

  const improvementId = String(updatedRow.improvement_id ?? "");
  if (!improvementId) throw new Error("자동개선 항목 연결이 비어 있습니다.");

  if (input.status === "production_verified") {
    if (!input.mergeSha) throw new Error("실제 서비스 반영 커밋이 비어 있습니다.");
    await markRegressionApplied({
      improvementId,
      targetRepo: repository,
      mergeSha: input.mergeSha,
      validation: input.validation ?? object(updatedRow.validation),
    });
  } else if (input.status === "rolled_back") {
    await markRegressionRolledBack(improvementId);
  }

  return { ok: true, status: storedStatus };
}

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

export async function claimReliabilityAutoImprovementJob(
  repository: string,
  runner: string,
) {
  const admin = await adminClient();
  await admin.rpc("requeue_expired_reliability_auto_improvement_jobs");
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
  const result = await admin
    .from("reliability_auto_improvement_jobs")
    .update({
      status: "ready",
      plan: input.plan,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.job.id)
    .eq("lease_token", input.job.lease_token)
    .eq("status", "planning")
    .select("id")
    .maybeSingle();
  if (result.error || !result.data) {
    throw new Error(
      `자동개선 계획을 안전하게 고정하지 못했습니다${result.error ? `: ${result.error.message}` : "."}`,
    );
  }
  await admin.from("reliability_auto_improvement_activity").insert({
    job_id: input.job.id,
    event_type: "plan_ready",
    from_status: "planning",
    to_status: "ready",
    summary: "수정할 파일과 변경 내용을 안전구역 안에서 확정했습니다.",
  });
}

async function markRegressionApplied(input: {
  improvementId: string;
  targetRepo: string;
  mergeSha: string;
  validation: Record<string, unknown>;
}) {
  const admin = await adminClient();
  const improvementResult = await admin
    .from("reliability_improvements")
    .select("id,incident_id,regression_case_id,target_test_name")
    .eq("id", input.improvementId)
    .maybeSingle();
  if (improvementResult.error || !improvementResult.data) {
    throw new Error("자동개선 반영 근거가 될 학습 항목을 찾지 못했습니다.");
  }
  const improvement = improvementResult.data as {
    incident_id: string;
    regression_case_id: string | null;
    target_test_name: string | null;
  };
  const testPath = String(input.validation.test_path ?? "").slice(0, 500);
  const testName = String(
    input.validation.test_name ??
      improvement.target_test_name ??
      "자동개선 재발 방지 확인",
  ).slice(0, 500);
  const evidence = {
    autoImprovement: true,
    validation: input.validation,
    productionVerifiedAt: new Date().toISOString(),
  };

  let regressionId = improvement.regression_case_id;
  if (!regressionId) {
    const latest = await admin
      .from("reliability_regression_cases")
      .select("id")
      .eq("incident_id", improvement.incident_id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    regressionId = latest.data?.id ?? null;
  }

  if (regressionId) {
    const updated = await admin
      .from("reliability_regression_cases")
      .update({
        source_repo: input.targetRepo,
        test_path: testPath,
        test_name: testName,
        protected_invariant: "동일한 저위험 운영 오류가 재발하지 않아야 합니다.",
        status: "implemented",
        workflow_name: "Reliability Auto Improvement Validate",
        commit_sha: input.mergeSha,
        last_run_at: new Date().toISOString(),
        evidence,
      })
      .eq("id", regressionId)
      .select("id")
      .maybeSingle();
    if (updated.error || !updated.data) {
      throw new Error("자동개선 GitHub 반영 근거를 갱신하지 못했습니다.");
    }
    return;
  }

  const created = await admin
    .from("reliability_regression_cases")
    .insert({
      incident_id: improvement.incident_id,
      source_repo: input.targetRepo,
      test_path: testPath,
      test_name: testName,
      protected_invariant: "동일한 저위험 운영 오류가 재발하지 않아야 합니다.",
      status: "implemented",
      workflow_name: "Reliability Auto Improvement Validate",
      commit_sha: input.mergeSha,
      last_run_at: new Date().toISOString(),
      evidence,
    })
    .select("id")
    .single();
  if (created.error) {
    throw new Error(`자동개선 회귀방지 근거를 만들지 못했습니다: ${created.error.message}`);
  }
}

async function markRegressionRolledBack(improvementId: string) {
  const admin = await adminClient();
  const improvement = await admin
    .from("reliability_improvements")
    .select("regression_case_id")
    .eq("id", improvementId)
    .maybeSingle();
  const regressionId = improvement.data?.regression_case_id;
  if (!regressionId) return;
  await admin
    .from("reliability_regression_cases")
    .update({ status: "failing", last_run_at: new Date().toISOString() })
    .eq("id", regressionId);
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
  const current = currentResult.data as Record<string, unknown>;
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

  await admin.from("reliability_auto_improvement_activity").insert({
    job_id: input.jobId,
    event_type: input.status,
    from_status: currentStatus,
    to_status: storedStatus,
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

  if (input.status === "production_verified") {
    if (!input.mergeSha) throw new Error("실제 서비스 반영 커밋이 비어 있습니다.");
    await markRegressionApplied({
      improvementId: String(updated.data.improvement_id),
      targetRepo: repository,
      mergeSha: input.mergeSha,
      validation: input.validation ?? object(updated.data.validation),
    });
  } else if (input.status === "rolled_back") {
    await markRegressionRolledBack(String(updated.data.improvement_id));
  }

  return { ok: true, status: storedStatus };
}

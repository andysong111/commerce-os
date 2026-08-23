import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

export async function reportReliabilityAutoImprovement(
  repository: string,
  input: ReliabilityAutoImprovementReport,
) {
  const admin = await adminClient();
  const result = await rpc(admin, "report_reliability_auto_improvement_stage", {
    p_target_repo: repository,
    p_job_id: input.jobId,
    p_lease_token: input.leaseToken,
    p_status: input.status,
    p_branch_name: input.branchName ?? null,
    p_pr_number: input.prNumber ?? null,
    p_head_sha: input.headSha ?? null,
    p_merge_sha: input.mergeSha ?? null,
    p_preview_url: input.previewUrl ?? null,
    p_production_url: input.productionUrl ?? null,
    p_validation: input.validation ?? null,
    p_error: input.error ?? null,
  });
  const payload = object(result);
  if (payload.ok !== true) {
    throw new Error("자동개선 진행 상태를 원자적으로 저장하지 못했습니다.");
  }
  return {
    ok: true,
    status: String(payload.status ?? input.status),
  };
}

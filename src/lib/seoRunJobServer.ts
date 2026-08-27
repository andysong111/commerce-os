import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  readProductLaunchError,
  readResponseJson,
  type ProductLaunchAdminConfig,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

export const SEO_RUN_JOB_TABLE = "seo_run_jobs";
export const SEO_RUN_JOB_MAX_ACTIVE = 200;

export type SeoRunJobStatus =
  | "queued"
  | "running"
  | "ready"
  | "failed"
  | "cancelled";

export type SeoRunJobStage =
  | "collect_source"
  | "analyze_identity"
  | "discover_keywords"
  | "score_keywords"
  | "expand_keywords"
  | "filter_keywords"
  | "generate_title"
  | "compose_final"
  | "completed";

export type SeoRunRegistrationStatus =
  | "idle"
  | "submitting"
  | "queued"
  | "running"
  | "success"
  | "failed";

export type SeoRunJobRow = {
  run_id: string;
  owner_id: string;
  owner_email: string;
  batch_id: string;
  launch_item_id: string;
  tracker_row_number: number | null;
  model_number: string;
  product_name: string;
  source_url: string;
  status: SeoRunJobStatus;
  stage: SeoRunJobStage;
  stage_index: number;
  progress_percent: number;
  message: string;
  input_payload: Record<string, unknown>;
  checkpoint_payload: Record<string, unknown>;
  result_payload: Record<string, unknown>;
  error_message: string;
  attempt_count: number;
  max_attempts: number;
  not_before: string;
  lease_owner: string | null;
  lease_until: string | null;
  registration_status: SeoRunRegistrationStatus;
  registration_job_id: string;
  registration_request_id: string;
  registration_payload: Record<string, unknown>;
  run_created_at: string;
  started_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SeoRunJobContext = {
  config: ProductLaunchAdminConfig;
  identity: ProductLaunchIdentity;
};

export type SeoRunJobInsert = Pick<
  SeoRunJobRow,
  | "run_id"
  | "batch_id"
  | "launch_item_id"
  | "tracker_row_number"
  | "model_number"
  | "product_name"
  | "source_url"
  | "input_payload"
  | "run_created_at"
> &
  Partial<
    Pick<
      SeoRunJobRow,
      | "status"
      | "stage"
      | "stage_index"
      | "progress_percent"
      | "message"
      | "max_attempts"
      | "not_before"
    >
  >;

type UnknownRecord = Record<string, unknown>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function postgrestIn(values: string[]) {
  return values
    .map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(",");
}

async function requestStorage<T>(
  config: ProductLaunchAdminConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...createSupabaseAdminHeaders(config.secretKey),
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const body = await readResponseJson(response);
  if (!response.ok) throw new Error(readProductLaunchError(body, response.status));
  return body as T;
}

export async function insertSeoRunJobs(
  context: SeoRunJobContext,
  rows: SeoRunJobInsert[],
) {
  if (!rows.length) return [];
  const payload = rows.map((row) => ({
    ...row,
    owner_id: context.identity.userId,
    owner_email: context.identity.email,
    status: row.status ?? "queued",
    stage: row.stage ?? "collect_source",
    stage_index: row.stage_index ?? 0,
    progress_percent: row.progress_percent ?? 0,
    message: row.message ?? "서버 실행 대기",
    max_attempts: row.max_attempts ?? 5,
    not_before: row.not_before ?? new Date().toISOString(),
  }));
  const params = new URLSearchParams({ on_conflict: "run_id" });
  const saved = await requestStorage<SeoRunJobRow[]>(
    context.config,
    `${SEO_RUN_JOB_TABLE}?${params.toString()}`,
    {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(payload),
    },
  );
  return Array.isArray(saved) ? saved : [];
}

export async function listSeoRunJobs(
  context: SeoRunJobContext,
  options: {
    includeArchived?: boolean;
    runIds?: string[];
    launchItemIds?: string[];
    limit?: number;
  } = {},
) {
  const params = new URLSearchParams({
    select: "*",
    owner_id: `eq.${context.identity.userId}`,
    order: "run_created_at.asc,created_at.asc",
    limit: String(
      Math.max(
        1,
        Math.min(1000, Math.trunc(options.limit ?? SEO_RUN_JOB_MAX_ACTIVE)),
      ),
    ),
  });
  if (!options.includeArchived) params.set("archived_at", "is.null");
  const runIds = [...new Set((options.runIds ?? []).map(text).filter(Boolean))];
  if (runIds.length) params.set("run_id", `in.(${postgrestIn(runIds)})`);
  const itemIds = [
    ...new Set((options.launchItemIds ?? []).map(text).filter(Boolean)),
  ];
  if (itemIds.length) {
    params.set("launch_item_id", `in.(${postgrestIn(itemIds)})`);
  }
  const rows = await requestStorage<SeoRunJobRow[]>(
    context.config,
    `${SEO_RUN_JOB_TABLE}?${params.toString()}`,
  );
  return Array.isArray(rows) ? rows : [];
}

export async function patchOwnedSeoRunJobs(
  context: SeoRunJobContext,
  runIds: string[],
  patch: Record<string, unknown>,
) {
  const ids = [...new Set(runIds.map(text).filter(Boolean))].slice(0, 200);
  if (!ids.length) return [];
  const params = new URLSearchParams({
    owner_id: `eq.${context.identity.userId}`,
    run_id: `in.(${postgrestIn(ids)})`,
  });
  const rows = await requestStorage<SeoRunJobRow[]>(
    context.config,
    `${SEO_RUN_JOB_TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    },
  );
  return Array.isArray(rows) ? rows : [];
}

export async function archiveSeoRunJobs(
  context: SeoRunJobContext,
  runIds: string[],
) {
  return patchOwnedSeoRunJobs(context, runIds, {
    archived_at: new Date().toISOString(),
  });
}

export async function retrySeoRunJobs(
  context: SeoRunJobContext,
  runIds: string[],
) {
  return patchOwnedSeoRunJobs(context, runIds, {
    status: "queued",
    error_message: "",
    attempt_count: 0,
    not_before: new Date().toISOString(),
    lease_owner: null,
    lease_until: null,
    completed_at: null,
    message: "저장된 체크포인트에서 서버 재실행 대기",
  });
}

export async function claimNextSeoRunJob(
  config: ProductLaunchAdminConfig,
  workerId: string,
  leaseSeconds = 420,
) {
  const body = await requestStorage<UnknownRecord>(
    config,
    "rpc/claim_next_seo_run_job",
    {
      method: "POST",
      body: JSON.stringify({
        p_worker_id: workerId,
        p_lease_seconds: leaseSeconds,
      }),
    },
  );
  if (body.claimed !== true) return null;
  const job = record(body.job) as SeoRunJobRow;
  return text(job.run_id) ? job : null;
}

export async function patchClaimedSeoRunJob(
  config: ProductLaunchAdminConfig,
  runId: string,
  workerId: string,
  patch: Record<string, unknown>,
) {
  const params = new URLSearchParams({
    run_id: `eq.${runId}`,
    lease_owner: `eq.${workerId}`,
  });
  const rows = await requestStorage<SeoRunJobRow[]>(
    config,
    `${SEO_RUN_JOB_TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    },
  );
  const saved = Array.isArray(rows) ? rows[0] ?? null : null;
  if (!saved) throw new Error(`SEO RUN ${runId} lease ownership was lost.`);
  return saved;
}

export async function readSeoRunJobById(
  config: ProductLaunchAdminConfig,
  runId: string,
) {
  const params = new URLSearchParams({
    select: "*",
    run_id: `eq.${runId}`,
    limit: "1",
  });
  const rows = await requestStorage<SeoRunJobRow[]>(
    config,
    `${SEO_RUN_JOB_TABLE}?${params.toString()}`,
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
}

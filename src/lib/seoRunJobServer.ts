import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import {
  readProductLaunchError,
  readResponseJson,
  type ProductLaunchAdminConfig,
  type ProductLaunchIdentity,
} from "@/lib/productLaunchTrackerServer";

export const SEO_RUN_JOB_TABLE = "seo_run_jobs";
export const SEO_RUN_JOB_MAX_ACTIVE = 200;

const SEO_RUN_READ_ATTEMPTS = 4;
const SEO_RUN_READ_TIMEOUT_MS = 12_000;
const SEO_RUN_WRITE_TIMEOUT_MS = 30_000;
const SEO_RUN_PATCH_RECONCILE_ATTEMPTS = 2;
const SEO_RUN_READ_RETRY_DELAYS_MS = [1_500, 3_000, 6_000];
const SEO_RUN_PATCH_RETRY_DELAYS_MS = [1_500];
const SEO_RUN_TRANSIENT_STORAGE_STATUSES = new Set([
  408,
  425,
  429,
  500,
  502,
  503,
  504,
  521,
]);
const SEO_RUN_LIST_SELECT = [
  "run_id",
  "owner_id",
  "owner_email",
  "batch_id",
  "launch_item_id",
  "tracker_row_number",
  "model_number",
  "product_name",
  "source_url",
  "status",
  "stage",
  "stage_index",
  "progress_percent",
  "message",
  "result_payload",
  "error_message",
  "attempt_count",
  "max_attempts",
  "not_before",
  "lease_owner",
  "lease_until",
  "registration_status",
  "registration_job_id",
  "registration_request_id",
  "registration_payload",
  "run_created_at",
  "started_at",
  "completed_at",
  "archived_at",
  "created_at",
  "updated_at",
].join(",");

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

type StorageRequestOptions = {
  retryRead?: boolean;
  timeoutMs?: number;
  attempts?: number;
};

export class SeoRunLeaseLostError extends Error {
  constructor(runId: string) {
    super(`SEO RUN ${runId} lease ownership was lost.`);
    this.name = "SeoRunLeaseLostError";
  }
}

export function isSeoRunLeaseLostError(error: unknown) {
  return (
    error instanceof SeoRunLeaseLostError ||
    (error instanceof Error && error.name === "SeoRunLeaseLostError")
  );
}

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

function sleep(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function normalizeStorageError(error: unknown) {
  if (error instanceof Error) return error;
  return new Error(
    typeof error === "string" ? error : "SEO RUN 저장소 요청에 실패했습니다.",
  );
}

function storageTimeoutError(method: string, timeoutMs: number) {
  const error = new Error(
    `SEO_RUN_STORAGE_${method}_TIMEOUT: Supabase가 ${Math.round(
      timeoutMs / 1000,
    )}초 안에 응답하지 않았습니다.`,
  );
  error.name = "SeoRunStorageTimeoutError";
  return error;
}

function isTransientStorageError(error: unknown) {
  const message = normalizeStorageError(error).message.toLowerCase();
  return [
    "pgrst002",
    "schema cache",
    "could not query the database",
    "database system is not accepting connections",
    "connection terminated",
    "connection timeout",
    "connection refused",
    "connection reset",
    "fetch failed",
    "network",
    "timed out",
    "timeout",
    "aborted",
    "econnreset",
    "econnrefused",
    "http 500",
    "http 502",
    "http 503",
    "http 504",
    "http 521",
  ].some((token) => message.includes(token));
}

function isTransientStorageFailure(status: number, body: unknown, error: Error) {
  if (SEO_RUN_TRANSIENT_STORAGE_STATUSES.has(status)) return true;
  const code = text(record(body).code).toLowerCase();
  return code === "pgrst002" || isTransientStorageError(error);
}

function boundedTimeout(value: unknown, fallback: number) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1_000, Math.min(60_000, parsed));
}

async function requestStorage<T>(
  config: ProductLaunchAdminConfig,
  path: string,
  init: RequestInit = {},
  options: StorageRequestOptions = {},
): Promise<T> {
  const method = String(init.method ?? "GET").toUpperCase();
  const readMethod = ["GET", "HEAD"].includes(method);
  const retryRead = options.retryRead === true && readMethod;
  const attempts = retryRead
    ? Math.max(
        1,
        Math.min(
          SEO_RUN_READ_ATTEMPTS,
          Math.trunc(options.attempts ?? SEO_RUN_READ_ATTEMPTS),
        ),
      )
    : 1;
  const timeoutMs = boundedTimeout(
    options.timeoutMs,
    readMethod ? SEO_RUN_READ_TIMEOUT_MS : SEO_RUN_WRITE_TIMEOUT_MS,
  );
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
        ...init,
        headers: {
          ...createSupabaseAdminHeaders(config.secretKey),
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
        cache: "no-store",
      });
      const body = await readResponseJson(response);
      if (response.ok) return body as T;

      const error = new Error(readProductLaunchError(body, response.status));
      lastError = error;
      if (
        attempt >= attempts ||
        !retryRead ||
        !isTransientStorageFailure(response.status, body, error)
      ) {
        throw error;
      }
    } catch (error) {
      const normalized =
        error instanceof Error && error.name === "AbortError"
          ? storageTimeoutError(method, timeoutMs)
          : normalizeStorageError(error);
      lastError = normalized;
      if (
        attempt >= attempts ||
        !retryRead ||
        !isTransientStorageError(normalized)
      ) {
        throw normalized;
      }
    } finally {
      clearTimeout(timer);
    }

    const delayMs =
      SEO_RUN_READ_RETRY_DELAYS_MS[
        Math.min(attempt - 1, SEO_RUN_READ_RETRY_DELAYS_MS.length - 1)
      ] ?? 0;
    if (delayMs > 0) await sleep(delayMs);
  }

  throw lastError ?? new Error("SEO RUN 저장소를 읽지 못했습니다.");
}

function sameInstant(left: unknown, right: unknown) {
  const leftTime = Date.parse(text(left));
  const rightTime = Date.parse(text(right));
  return (
    Number.isFinite(leftTime) &&
    Number.isFinite(rightTime) &&
    Math.abs(leftTime - rightTime) <= 5
  );
}

function patchValueMatches(key: string, actual: unknown, expected: unknown) {
  if (key.endsWith("_at") || key === "not_before" || key === "lease_until") {
    if (actual === null || expected === null) return actual === expected;
    return sameInstant(actual, expected);
  }
  return actual === expected;
}

function patchWasApplied(
  row: SeoRunJobRow,
  marker: string,
  patch: Record<string, unknown>,
) {
  if (sameInstant(row.updated_at, marker)) return true;
  const comparableKeys = [
    "status",
    "stage",
    "stage_index",
    "progress_percent",
    "message",
    "error_message",
    "attempt_count",
    "max_attempts",
    "not_before",
    "lease_owner",
    "lease_until",
    "registration_status",
    "registration_job_id",
    "registration_request_id",
    "completed_at",
    "archived_at",
  ].filter((key) => Object.prototype.hasOwnProperty.call(patch, key));
  return (
    comparableKeys.length > 0 &&
    comparableKeys.every((key) =>
      patchValueMatches(
        key,
        (row as unknown as UnknownRecord)[key],
        patch[key],
      ),
    )
  );
}

async function readSeoRunJobByIdWithOptions(
  config: ProductLaunchAdminConfig,
  runId: string,
  options: StorageRequestOptions,
) {
  const params = new URLSearchParams({
    select: "*",
    run_id: `eq.${runId}`,
    limit: "1",
  });
  const rows = await requestStorage<SeoRunJobRow[]>(
    config,
    `${SEO_RUN_JOB_TABLE}?${params.toString()}`,
    {},
    options,
  );
  return Array.isArray(rows) ? rows[0] ?? null : null;
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
    select: SEO_RUN_LIST_SELECT,
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
    {},
    { retryRead: true },
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
    select: SEO_RUN_LIST_SELECT,
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
    { timeoutMs: 15_000 },
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
  const marker = new Date().toISOString();
  const payload = { ...patch, updated_at: marker };
  let lastError: Error | null = null;

  for (
    let attempt = 1;
    attempt <= SEO_RUN_PATCH_RECONCILE_ATTEMPTS;
    attempt += 1
  ) {
    try {
      const rows = await requestStorage<SeoRunJobRow[]>(
        config,
        `${SEO_RUN_JOB_TABLE}?${params.toString()}`,
        {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify(payload),
        },
      );
      const saved = Array.isArray(rows) ? rows[0] ?? null : null;
      if (saved) return saved;
    } catch (error) {
      const normalized = normalizeStorageError(error);
      lastError = normalized;
      if (!isTransientStorageError(normalized)) throw normalized;
    }

    const current = await readSeoRunJobByIdWithOptions(config, runId, {
      retryRead: true,
      attempts: 2,
      timeoutMs: 10_000,
    }).catch(() => null);
    if (current && patchWasApplied(current, marker, patch)) return current;
    if (current && current.lease_owner !== workerId) {
      throw new SeoRunLeaseLostError(runId);
    }
    if (attempt >= SEO_RUN_PATCH_RECONCILE_ATTEMPTS) break;
    const delayMs =
      SEO_RUN_PATCH_RETRY_DELAYS_MS[
        Math.min(attempt - 1, SEO_RUN_PATCH_RETRY_DELAYS_MS.length - 1)
      ] ?? 0;
    if (delayMs > 0) await sleep(delayMs);
  }

  if (lastError) throw lastError;
  throw new SeoRunLeaseLostError(runId);
}

export async function readSeoRunJobById(
  config: ProductLaunchAdminConfig,
  runId: string,
) {
  return readSeoRunJobByIdWithOptions(config, runId, {
    retryRead: true,
  });
}

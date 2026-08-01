import type { NextRequest } from "next/server";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createDetailPageJobToken,
  verifyDetailPageJobToken,
} from "@/lib/detailPageJobToken";
import {
  isOpsLoginTemporarilyDisabled,
  isSameOriginOpsRequest,
  temporaryOpsIdentity,
} from "@/lib/opsLoginBypass";

// Reuse the already deployed durable job table. Detail-page jobs are isolated
// by payload.kind and never enter the Shopling upload worker.
export const DETAIL_PAGE_JOB_TABLE = "product_launch_upload_jobs";

export type DetailPageJobIdentity = { userId: string; email: string };
export type DetailPageJobConfig = { supabaseUrl: string; secretKey: string };
export type DetailPageJobRow = {
  id: string;
  owner_id: string;
  owner_email: string;
  launch_item_id: string;
  status: "collecting" | "queued" | "running" | "render_pending" | "success" | "failed" | "cancelled";
  stage: string;
  message: string;
  progress: number;
  qa_status: string;
  attempt: number;
  source_url: string;
  sales_options: string;
  source_run_id: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  error_message: string;
  step_version: number;
  lease_owner: string;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type RawDetailPageJobRow = {
  id: string;
  owner_id: string;
  owner_email: string;
  launch_item_id: string;
  request_id: string;
  status: "queued" | "running" | "success" | "partial_failure" | "failed";
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error_message: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export function getDetailPageJobConfig():
  | { ok: true; value: DetailPageJobConfig }
  | { ok: false; status: number; body: { ok: false; code: string; message: string } } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!supabaseUrl || !secretKey) {
    return {
      ok: false,
      status: 503,
      body: {
        ok: false,
        code: "SUPABASE_NOT_CONFIGURED",
        message: "상세페이지 백그라운드 작업 저장소 환경변수가 없습니다.",
      },
    };
  }
  return { ok: true, value: { supabaseUrl, secretKey } };
}

export async function resolveDetailPageJobIdentity(
  request: NextRequest,
  requireSameOrigin = true,
): Promise<
  | { ok: true; value: DetailPageJobIdentity }
  | { ok: false; status: number; body: { ok: false; code: string; message: string } }
> {
  if (requireSameOrigin && !isSameOriginOpsRequest(request)) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        code: "SAME_ORIGIN_REQUIRED",
        message: "OPS Center 화면에서만 상세페이지 작업을 조작할 수 있습니다.",
      },
    };
  }
  if (isOpsLoginTemporarilyDisabled()) {
    return { ok: true, value: temporaryOpsIdentity() };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false,
      status: 503,
      body: {
        ok: false,
        code: "SUPABASE_NOT_CONFIGURED",
        message: "OPS 로그인 서버 연결이 설정되지 않았습니다.",
      },
    };
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return {
      ok: false,
      status: 401,
      body: {
        ok: false,
        code: "AUTH_REQUIRED",
        message: "상세페이지 작업을 사용하려면 로그인해야 합니다.",
      },
    };
  }
  return {
    ok: true,
    value: {
      userId: data.user.id,
      email: data.user.email?.toLowerCase() ?? "",
    },
  };
}

export { createDetailPageJobToken, verifyDetailPageJobToken };

export function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}

export function isValidDetailPageJobId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function readDetailPageJob(
  config: DetailPageJobConfig,
  jobId: string,
) {
  const params = new URLSearchParams({ select: "*", id: `eq.${jobId}`, limit: "1" });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${DETAIL_PAGE_JOB_TABLE}?${params.toString()}`,
    { headers: createSupabaseAdminHeaders(config.secretKey), cache: "no-store" },
  );
  const body = await readDetailPageJobJson(response);
  if (!response.ok) throw new Error(readDetailPageJobError(body, response.status));
  const raw = (Array.isArray(body) ? body[0] : null) as RawDetailPageJobRow | null;
  return raw?.payload?.kind === "detail_page" ? normalizeJobRow(raw) : null;
}

export async function listDetailPageJobs(
  config: DetailPageJobConfig,
  ownerId: string,
  limit = 50,
) {
  const params = new URLSearchParams({
    select: "*",
    owner_id: `eq.${ownerId}`,
    "payload->>kind": "eq.detail_page",
    order: "updated_at.desc",
    limit: String(Math.min(100, Math.max(1, limit))),
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${DETAIL_PAGE_JOB_TABLE}?${params.toString()}`,
    { headers: createSupabaseAdminHeaders(config.secretKey), cache: "no-store" },
  );
  const body = await readDetailPageJobJson(response);
  if (!response.ok) throw new Error(readDetailPageJobError(body, response.status));
  return (Array.isArray(body) ? body : [])
    .filter((row): row is RawDetailPageJobRow =>
      Boolean(row && typeof row === "object" && row.payload?.kind === "detail_page"),
    )
    .map(normalizeJobRow);
}

export async function listRecoverableDetailPageJobs(
  config: DetailPageJobConfig,
  limit = 25,
) {
  const params = new URLSearchParams({
    select: "*",
    status: "in.(queued,running)",
    "payload->>kind": "eq.detail_page",
    order: "updated_at.asc",
    limit: String(Math.min(100, Math.max(1, limit))),
  });
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${DETAIL_PAGE_JOB_TABLE}?${params.toString()}`,
    { headers: createSupabaseAdminHeaders(config.secretKey), cache: "no-store" },
  );
  const body = await readDetailPageJobJson(response);
  if (!response.ok) throw new Error(readDetailPageJobError(body, response.status));
  return (Array.isArray(body) ? body : [])
    .filter((row): row is RawDetailPageJobRow =>
      Boolean(row && typeof row === "object" && row.payload?.kind === "detail_page"),
    )
    .map(normalizeJobRow)
    .filter((job) => ["queued", "running"].includes(job.status));
}

export async function insertDetailPageJob(
  config: DetailPageJobConfig,
  row: Record<string, unknown>,
) {
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${DETAIL_PAGE_JOB_TABLE}`,
    {
      method: "POST",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=representation",
      },
      body: JSON.stringify(row),
      cache: "no-store",
    },
  );
  const body = await readDetailPageJobJson(response);
  if (!response.ok) throw new Error(readDetailPageJobError(body, response.status));
  const raw = (Array.isArray(body) ? body[0] : null) as RawDetailPageJobRow | null;
  return raw ? normalizeJobRow(raw) : null;
}

export async function patchDetailPageJob(
  config: DetailPageJobConfig,
  jobId: string,
  patch: Record<string, unknown>,
) {
  const params = new URLSearchParams({ id: `eq.${jobId}` });
  const current = await readDetailPageJob(config, jobId);
  if (!current) return null;
  const payloadPatch = patch.payload as Record<string, unknown> | undefined;
  const resultPatch = patch.result as Record<string, unknown> | undefined;
  const logicalStatus = String(patch.status ?? current.status) as DetailPageJobRow["status"];
  const terminal = ["success", "failed", "cancelled"].includes(logicalStatus);
  const rowPatch: Record<string, unknown> = {
    payload: {
      ...current.payload,
      ...payloadPatch,
      logical_status: logicalStatus,
      stage: patch.stage ?? current.stage,
      message: patch.message ?? current.message,
      progress: patch.progress ?? current.progress,
      qa_status: patch.qa_status ?? current.qa_status,
      source_run_id: patch.source_run_id ?? current.source_run_id,
      step_version: patch.step_version ?? current.step_version,
      lease_owner: patch.lease_owner ?? current.lease_owner,
      lease_until: patch.lease_until ?? current.lease_until,
      started_at: patch.started_at ?? current.started_at,
    },
    result: resultPatch ? { ...current.result, ...resultPatch } : current.result,
    error_message: patch.error_message ?? current.error_message,
    status:
      logicalStatus === "success"
        ? "success"
        : logicalStatus === "failed" || logicalStatus === "cancelled"
          ? "failed"
          : logicalStatus === "queued"
            ? "queued"
            : "running",
    updated_at: patch.updated_at ?? new Date().toISOString(),
    completed_at:
      patch.completed_at ?? (terminal ? new Date().toISOString() : current.completed_at),
  };
  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/${DETAIL_PAGE_JOB_TABLE}?${params.toString()}`,
    {
      method: "PATCH",
      headers: {
        ...createSupabaseAdminHeaders(config.secretKey),
        Prefer: "return=representation",
      },
      body: JSON.stringify(rowPatch),
      cache: "no-store",
    },
  );
  const body = await readDetailPageJobJson(response);
  if (!response.ok) throw new Error(readDetailPageJobError(body, response.status));
  const raw = (Array.isArray(body) ? body[0] : null) as RawDetailPageJobRow | null;
  return raw ? normalizeJobRow(raw) : null;
}

function normalizeJobRow(raw: RawDetailPageJobRow): DetailPageJobRow {
  const payload = raw.payload ?? {};
  const result = raw.result ?? {};
  const logicalStatus = String(
    payload.logical_status ||
      (raw.status === "success" ? "success" : raw.status === "failed" ? "failed" : raw.status),
  ) as DetailPageJobRow["status"];
  return {
    id: raw.id,
    owner_id: raw.owner_id,
    owner_email: raw.owner_email,
    launch_item_id: raw.launch_item_id,
    status: logicalStatus,
    stage: String(payload.stage ?? "source_collection"),
    message: String(payload.message ?? ""),
    progress: Number(payload.progress ?? 0),
    qa_status: String(payload.qa_status ?? "pending"),
    attempt: Number(payload.attempt ?? 1),
    source_url: String(payload.source_url ?? ""),
    sales_options: String(payload.sales_options ?? ""),
    source_run_id: String(payload.source_run_id ?? ""),
    payload,
    result,
    error_message: raw.error_message ?? "",
    step_version: Number(payload.step_version ?? 0),
    lease_owner: String(payload.lease_owner ?? ""),
    lease_until: typeof payload.lease_until === "string" ? payload.lease_until : null,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    started_at: typeof payload.started_at === "string" ? payload.started_at : null,
    completed_at: raw.completed_at,
  };
}

export async function readDetailPageJobJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function readDetailPageJobError(body: unknown, status: number) {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return `상세페이지 작업 저장소 요청에 실패했습니다. status=${status}`;
}

export function publicDetailPageJob(row: DetailPageJobRow) {
  return {
    jobId: row.id,
    itemId: row.launch_item_id,
    status: row.status,
    stage: row.stage,
    message: row.message,
    progress: row.progress,
    qaStatus: row.qa_status,
    attempt: row.attempt,
    sourceUrl: row.source_url,
    sourceRunId: row.source_run_id,
    payload: row.payload ?? {},
    result: row.result ?? {},
    error: row.error_message,
    stepVersion: row.step_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

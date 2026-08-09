import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminHeaders } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isOpsLoginTemporarilyDisabled,
  isSameOriginOpsRequest,
  temporaryOpsIdentity,
} from "@/lib/opsLoginBypass";
import {
  bearerToken,
  type DetailPageJobRow,
  getDetailPageJobConfig,
  readDetailPageJob,
  verifyDetailPageJobToken,
} from "@/lib/detailPageJobServer";
import {
  DETAIL_PAGE_STAGED_PIPELINE_VERSION,
  matchesDetailPageExecution,
} from "@/lib/detailPageJobRecovery";
import {
  isAllowedDetailPageAssetRole,
  normalizeDetailPageAssetRole,
} from "@/lib/detailPageAssetRole";

const BUCKET_NAME = "product-launch-assets";
// Vercel 함수 요청 본문 한도보다 여유를 두고, 상세페이지 엔진도 같은
// 상한에 맞춰 JPEG 품질을 단계적으로 조정합니다.
const MAX_FILE_BYTES = 4_000_000;
const REVISION_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const TRANSIENT_ATTEMPTS = 3;
const TRANSIENT_REQUEST_TIMEOUT_MS = 30_000;
const TRANSIENT_DATABASE_PATTERN =
  /connection to the database timed out|database.*timed out|connection.*timed out|statement timeout|too many connections|connection reset|temporar(?:y|ily)|service unavailable|gateway timeout/i;
let publicBucketReady = false;

type TrackerIdentity = {
  userId: string;
  email: string;
  workerJob?: DetailPageJobRow;
};

type StorageRequestResult = {
  ok: boolean;
  status: number;
  body: unknown;
};

export async function POST(request: NextRequest) {
  const config = getAdminConfig();
  if (!config.ok) return Response.json(config.body, { status: 503 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return invalid("업로드할 상세페이지 이미지 form-data가 필요합니다.");
  }
  const file = form.get("file");
  const itemId = safeSegment(form.get("item_id"));
  const jobId = safeSegment(form.get("job_id"));
  const requestedRole = String(form.get("role") ?? "").trim();
  const role = normalizeDetailPageAssetRole(requestedRole);
  const revision = String(form.get("revision") ?? "").trim().toLowerCase();
  const executionId = String(form.get("execution_id") ?? "").trim();
  if (
    !(file instanceof File) ||
    !itemId ||
    !jobId ||
    !isAllowedDetailPageAssetRole(role)
  ) {
    return invalid("상품·작업·이미지 역할 또는 파일 값이 올바르지 않습니다.");
  }
  if (revision && !REVISION_PATTERN.test(revision)) {
    return invalid("상세페이지 이미지 버전 값이 올바르지 않습니다.");
  }
  const identity = await resolveUploadIdentity(request, jobId, itemId);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
  const workerJob = identity.value.workerJob;
  if (workerJob && ["success", "failed", "cancelled"].includes(workerJob.status)) {
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_JOB_TERMINAL",
        message: "종료된 상세페이지 작업의 늦은 이미지 업로드를 차단했습니다.",
      },
      { status: 409 },
    );
  }
  if (workerJob && !matchesDetailPageExecution(workerJob, executionId)) {
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_EXECUTION_STALE",
        message: "이전 상세페이지 실행의 이미지 업로드를 차단했습니다.",
      },
      { status: 409 },
    );
  }
  if (
    workerJob?.payload.pipeline_version === DETAIL_PAGE_STAGED_PIPELINE_VERSION &&
    !revision
  ) {
    return invalid("단계형 상세페이지 이미지에는 변경 불가능한 버전 값이 필요합니다.");
  }
  if (!/^image\/jpe?g$/i.test(file.type)) {
    return invalid("상세페이지 결과 이미지는 JPG 형식이어야 합니다.");
  }
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
    return invalid("상세페이지 결과 이미지는 4MB 이하여야 합니다.");
  }

  const bucket = await ensurePublicBucket(config.supabaseUrl, config.secretKey);
  if (!bucket.ok) {
    return Response.json(bucket.body, { status: 502 });
  }

  const owner = safeSegment(identity.value.userId);
  const objectName = revision ? `${role}-${revision}.jpg` : `${role}.jpg`;
  const objectPath = `${owner}/${itemId}/${jobId}/${objectName}`;
  const headers = createSupabaseAdminHeaders(config.secretKey);
  headers["Content-Type"] = "image/jpeg";
  headers["x-upsert"] = "true";
  const upload = await storageRequestWithRetry(
    `${config.supabaseUrl}/storage/v1/object/${BUCKET_NAME}/${encodePath(objectPath)}`,
    {
      method: "POST",
      headers,
      body: await file.arrayBuffer(),
    },
  );
  if (!upload.ok) {
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_ASSET_UPLOAD_FAILED",
        message: readErrorMessage(upload.body, upload.status),
      },
      { status: 502 },
    );
  }

  return Response.json({
    ok: true,
    role,
    path: objectPath,
    publicUrl: `${config.supabaseUrl}/storage/v1/object/public/${BUCKET_NAME}/${encodePath(objectPath)}?v=${randomUUID()}`,
  });
}

async function resolveUploadIdentity(
  request: NextRequest,
  jobId: string,
  itemId: string,
): Promise<
  | { ok: true; value: TrackerIdentity }
  | { ok: false; status: number; body: { ok: false; code: string; message: string } }
> {
  const token = bearerToken(request);
  if (token) {
    const config = getDetailPageJobConfig();
    if (!config.ok) return config;
    try {
      const job = await readDetailPageJobWithRetry(config.value, jobId);
      if (
        !job ||
        job.launch_item_id !== itemId ||
        !verifyDetailPageJobToken(config.value, job.owner_id, job.id, token)
      ) {
        return {
          ok: false,
          status: 401,
          body: {
            ok: false,
            code: "DETAIL_PAGE_JOB_AUTH_FAILED",
            message: "상세페이지 서버 작업 인증에 실패했습니다.",
          },
        };
      }
      return {
        ok: true,
        value: {
          userId: job.owner_id,
          email: job.owner_email,
          workerJob: job,
        },
      };
    } catch (error) {
      return {
        ok: false,
        status: 500,
        body: {
          ok: false,
          code: "DETAIL_PAGE_JOB_AUTH_LOOKUP_FAILED",
          message: error instanceof Error ? error.message : "상세페이지 작업을 확인하지 못했습니다.",
        },
      };
    }
  }
  if (!isSameOriginOpsRequest(request)) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        code: "SAME_ORIGIN_REQUIRED",
        message: "OPS Center 화면에서만 상세페이지 결과를 저장할 수 있습니다.",
      },
    };
  }
  return resolveIdentity();
}

async function readDetailPageJobWithRetry(
  config: Parameters<typeof readDetailPageJob>[0],
  jobId: string,
) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= TRANSIENT_ATTEMPTS; attempt += 1) {
    try {
      return await readDetailPageJob(config, jobId);
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseFailure(error) || attempt >= TRANSIENT_ATTEMPTS) {
        throw error;
      }
      await retryDelay(attempt);
    }
  }
  throw lastError;
}

function invalid(message: string) {
  return Response.json(
    { ok: false, code: "INVALID_DETAIL_PAGE_ASSET", message },
    { status: 400 },
  );
}

async function ensurePublicBucket(supabaseUrl: string, secretKey: string) {
  if (publicBucketReady) return { ok: true as const };

  const headers = createSupabaseAdminHeaders(secretKey);
  const inspect = await storageRequestWithRetry(
    `${supabaseUrl}/storage/v1/bucket/${BUCKET_NAME}`,
    {
      headers,
    },
  );
  if (inspect.ok) {
    publicBucketReady = true;
    return { ok: true as const };
  }
  if (inspect.status !== 400 && inspect.status !== 404) {
    return {
      ok: false as const,
      body: {
        ok: false,
        code: "DETAIL_PAGE_BUCKET_READ_FAILED",
        message: readErrorMessage(inspect.body, inspect.status),
      },
    };
  }

  const create = await storageRequestWithRetry(`${supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: BUCKET_NAME,
      name: BUCKET_NAME,
      public: true,
      file_size_limit: MAX_FILE_BYTES,
      allowed_mime_types: ["image/jpeg"],
    }),
  });
  if (create.ok || create.status === 409) {
    publicBucketReady = true;
    return { ok: true as const };
  }
  return {
    ok: false as const,
    body: {
      ok: false,
      code: "DETAIL_PAGE_BUCKET_CREATE_FAILED",
      message: readErrorMessage(create.body, create.status),
    },
  };
}

async function storageRequestWithRetry(
  url: string,
  init: RequestInit,
): Promise<StorageRequestResult> {
  let last: StorageRequestResult = {
    ok: false,
    status: 502,
    body: { message: "상세페이지 저장소 요청에 실패했습니다." },
  };

  for (let attempt = 1; attempt <= TRANSIENT_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(TRANSIENT_REQUEST_TIMEOUT_MS),
      });
      last = {
        ok: response.ok,
        status: response.status,
        body: await readJson(response),
      };
      if (
        last.ok ||
        !isRetryableStorageFailure(last.status, last.body) ||
        attempt >= TRANSIENT_ATTEMPTS
      ) {
        return last;
      }
    } catch (error) {
      last = {
        ok: false,
        status: 504,
        body: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
      if (!isTransientDatabaseFailure(error) || attempt >= TRANSIENT_ATTEMPTS) {
        return last;
      }
    }
    await retryDelay(attempt);
  }
  return last;
}

function isRetryableStorageFailure(status: number, body: unknown) {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500 ||
    TRANSIENT_DATABASE_PATTERN.test(readErrorMessage(body, status))
  );
}

function isTransientDatabaseFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    TRANSIENT_DATABASE_PATTERN.test(message) ||
    /timeout|timed out|fetch failed|econnreset|etimedout|socket hang up/i.test(message)
  );
}

async function retryDelay(attempt: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, 350 * attempt));
}

async function resolveIdentity(): Promise<
  | { ok: true; value: TrackerIdentity }
  | { ok: false; status: number; body: { ok: false; code: string; message: string } }
> {
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
        message: "Supabase 서버 연결이 설정되지 않았습니다.",
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
        message: "상세페이지 결과를 저장하려면 로그인해야 합니다.",
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

function getAdminConfig():
  | { ok: true; supabaseUrl: string; secretKey: string }
  | { ok: false; body: { ok: false; code: string; message: string } } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!supabaseUrl || !secretKey) {
    return {
      ok: false,
      body: {
        ok: false,
        code: "SUPABASE_NOT_CONFIGURED",
        message: "상세페이지 결과 저장소에 필요한 Supabase 환경변수가 없습니다.",
      },
    };
  }
  return { ok: true, supabaseUrl, secretKey };
}

function safeSegment(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return normalized || "";
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function readErrorMessage(body: unknown, status: number) {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (typeof body === "string" && body.trim()) return body;
  return `상세페이지 결과 저장 요청에 실패했습니다. status=${status}`;
}

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
  getDetailPageJobConfig,
  readDetailPageJob,
  verifyDetailPageJobToken,
} from "@/lib/detailPageJobServer";

const BUCKET_NAME = "product-launch-assets";
// Vercel 함수 요청 본문 한도보다 여유를 두고, 상세페이지 엔진도 같은
// 상한에 맞춰 JPEG 품질을 단계적으로 조정합니다.
const MAX_FILE_BYTES = 4_000_000;
const ROLE_PATTERN = /^(detail-page|main|additional-[1-4]|evidence-(?:[1-9]|[1-5][0-9]|60)|panel-[1-8])$/;

type TrackerIdentity = { userId: string; email: string };

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
  const role = String(form.get("role") ?? "").trim();
  if (!(file instanceof File) || !itemId || !jobId || !ROLE_PATTERN.test(role)) {
    return invalid("상품·작업·이미지 역할 또는 파일 값이 올바르지 않습니다.");
  }
  const identity = await resolveUploadIdentity(request, jobId, itemId);
  if (!identity.ok) return Response.json(identity.body, { status: identity.status });
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
  const objectPath = `${owner}/${itemId}/${jobId}/${role}.jpg`;
  const headers = createSupabaseAdminHeaders(config.secretKey);
  headers["Content-Type"] = "image/jpeg";
  headers["x-upsert"] = "true";
  const upload = await fetch(
    `${config.supabaseUrl}/storage/v1/object/${BUCKET_NAME}/${encodePath(objectPath)}`,
    {
      method: "POST",
      headers,
      body: await file.arrayBuffer(),
      cache: "no-store",
    },
  );
  const uploadBody = await readJson(upload);
  if (!upload.ok) {
    return Response.json(
      {
        ok: false,
        code: "DETAIL_PAGE_ASSET_UPLOAD_FAILED",
        message: readErrorMessage(uploadBody, upload.status),
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
      const job = await readDetailPageJob(config.value, jobId);
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
        value: { userId: job.owner_id, email: job.owner_email },
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

function invalid(message: string) {
  return Response.json(
    { ok: false, code: "INVALID_DETAIL_PAGE_ASSET", message },
    { status: 400 },
  );
}

async function ensurePublicBucket(supabaseUrl: string, secretKey: string) {
  const headers = createSupabaseAdminHeaders(secretKey);
  const inspect = await fetch(`${supabaseUrl}/storage/v1/bucket/${BUCKET_NAME}`, {
    headers,
    cache: "no-store",
  });
  if (inspect.ok) return { ok: true as const };
  if (inspect.status !== 400 && inspect.status !== 404) {
    const body = await readJson(inspect);
    return {
      ok: false as const,
      body: {
        ok: false,
        code: "DETAIL_PAGE_BUCKET_READ_FAILED",
        message: readErrorMessage(body, inspect.status),
      },
    };
  }

  const create = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: BUCKET_NAME,
      name: BUCKET_NAME,
      public: true,
      file_size_limit: MAX_FILE_BYTES,
      allowed_mime_types: ["image/jpeg"],
    }),
    cache: "no-store",
  });
  if (create.ok || create.status === 409) return { ok: true as const };
  const body = await readJson(create);
  return {
    ok: false as const,
    body: {
      ok: false,
      code: "DETAIL_PAGE_BUCKET_CREATE_FAILED",
      message: readErrorMessage(body, create.status),
    },
  };
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
  return `상세페이지 결과 저장 요청에 실패했습니다. status=${status}`;
}

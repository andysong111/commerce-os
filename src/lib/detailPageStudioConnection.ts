const PRODUCTION_STUDIO_URL =
  "https://commerce-os-detail-page-studio.vercel.app/";

const OPS_CENTER_V260807_STUDIO_URL = PRODUCTION_STUDIO_URL;

// Stable Vercel Preview retained only as a legacy recovery reference.
const PREVIEW_STUDIO_URL =
  "https://commerce-os-detail-page-studio-git-agent-final-96809d-a2bsangsa.vercel.app/";
const FINALIZER_PROTOCOL_VERSION = "server-finalizer-v1";

const STUDIO_WORKER_PATH = "/api/internal/ops-detail-page-job";
const OPS_CALLBACK_HEALTH_PATH =
  "/api/product-launch-tracker/detail-page-callback-health";
const BYPASS_PARAMETER = "x-vercel-protection-bypass";

export type DetailPageStudioConnection = {
  browserUrl: URL;
  engineOrigin: string;
  isPreview: boolean;
  requestHeaders: Record<string, string>;
  workerUrl: URL;
};

export function resolveDetailPageStudioConnection(): DetailPageStudioConnection {
  const configured =
    process.env.DETAIL_PAGE_STUDIO_INTERNAL_URL?.trim() ||
    process.env.NEXT_PUBLIC_DETAIL_PAGE_STUDIO_INTERNAL_URL?.trim();
  const environment = process.env.VERCEL_ENV?.trim();
  const isPreview = environment === "preview";
  const isProduction = environment === "production";
  // Product Launch Tracker uses the OPS v260807 code promoted on the original
  // Studio Production project, where the existing OpenAI server configuration
  // is already available. SaaS production/test cards remain on their own
  // isolated branch deployments.
  const engineUrl = validateStudioUrl(
    isPreview || isProduction
      ? OPS_CENTER_V260807_STUDIO_URL
      : configured || OPS_CENTER_V260807_STUDIO_URL,
  );
  const bypassSecret =
    process.env.DETAIL_PAGE_STUDIO_AUTOMATION_BYPASS_SECRET?.trim() || "";
  const browserUrl = new URL(engineUrl);
  const workerUrl = new URL(STUDIO_WORKER_PATH, engineUrl);
  const requestHeaders: Record<string, string> = {};

  if (bypassSecret) {
    requestHeaders[BYPASS_PARAMETER] = bypassSecret;
    browserUrl.searchParams.set(BYPASS_PARAMETER, bypassSecret);
    browserUrl.searchParams.set("x-vercel-set-bypass-cookie", "samesitenone");
    workerUrl.searchParams.set(BYPASS_PARAMETER, bypassSecret);
  }

  return {
    browserUrl,
    engineOrigin: engineUrl.origin,
    isPreview,
    requestHeaders,
    workerUrl,
  };
}

export function buildProtectedOpsCallbackUrl(requestUrl: string, path: string) {
  const callback = new URL(path, requestUrl);
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (bypassSecret) callback.searchParams.set(BYPASS_PARAMETER, bypassSecret);
  return callback;
}

export async function probeDetailPageStudio(
  connection: DetailPageStudioConnection,
) {
  try {
    const response = await fetch(connection.workerUrl, {
      method: "GET",
      headers: connection.requestHeaders,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false as const,
        code: "DETAIL_PAGE_STUDIO_PREVIEW_PROTECTED",
        message:
          "상세페이지 Studio 보호 인증이 연결되지 않았습니다. OPS 전용 Production 연결을 확인하세요.",
      };
    }
    const body = await response.json().catch(() => ({}));
    if (
      !response.ok ||
      body?.ok !== true ||
      body?.service !== "commerce-os-detail-page-studio" ||
      body?.opsDockVersion !== "server-v1" ||
      body?.finalizerProtocolVersion !== FINALIZER_PROTOCOL_VERSION
    ) {
      return {
        ok: false as const,
        code: "DETAIL_PAGE_STUDIO_INCOMPATIBLE",
        message:
          response.status === 404
            ? "연결된 상세페이지 Studio에 OPS 자동생성 기능이 없습니다. OPS 전용 v260807 Production 연결을 확인하세요."
            : "상세페이지 Studio 연결 규격을 확인하지 못했습니다.",
      };
    }
    if (body?.openaiConfigured !== true) {
      return {
        ok: false as const,
        code: "DETAIL_PAGE_STUDIO_OPENAI_NOT_CONFIGURED",
        message:
          "상세페이지 Studio 서버의 OpenAI 설정이 준비되지 않았습니다. 생성 작업은 시작하지 않았습니다.",
      };
    }
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      code: "DETAIL_PAGE_STUDIO_UNREACHABLE",
      message:
        error instanceof Error && error.name === "TimeoutError"
          ? "상세페이지 Studio가 10초 안에 응답하지 않았습니다."
          : "상세페이지 Studio에 연결하지 못했습니다.",
    };
  }
}

export async function probeProtectedOpsCallback(requestUrl: string) {
  const url = buildProtectedOpsCallbackUrl(
    requestUrl,
    OPS_CALLBACK_HEALTH_PATH,
  );
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || "";
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: secret ? { [BYPASS_PARAMETER]: secret } : {},
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false as const,
        code: "OPS_PREVIEW_CALLBACK_PROTECTED",
        message:
          "OPS Preview의 서버 콜백 보호 인증이 준비되지 않았습니다. OPS 자동화 우회 설정을 확인하세요.",
      };
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true || body?.opsCallbackVersion !== "server-v1") {
      return {
        ok: false as const,
        code: "OPS_CALLBACK_INCOMPATIBLE",
        message: "OPS 상세페이지 서버 콜백 연결 규격을 확인하지 못했습니다.",
      };
    }
    return { ok: true as const };
  } catch {
    return {
      ok: false as const,
      code: "OPS_CALLBACK_UNREACHABLE",
      message: "OPS 상세페이지 서버 콜백 연결을 확인하지 못했습니다.",
    };
  }
}

function validateStudioUrl(value: string) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((!local && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("상세페이지 엔진 연결 주소는 안전한 HTTPS 주소여야 합니다.");
  }
  url.hash = "";
  return url;
}

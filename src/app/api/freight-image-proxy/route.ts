import {
  isAllowedFreightImageHost,
  normalizeFreightImageUpstreamUrl,
} from "@/lib/freightImageProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_CONTENT_LENGTH = 12 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/bmp",
]);

const BROWSER_HEADERS: Record<string, string> = {
  accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  "accept-language": "zh-CN,zh;q=0.9,ko;q=0.8,en;q=0.7",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

function jsonError(status: number, code: string, message: string) {
  return Response.json(
    { ok: false, code, message },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function inferredContentType(url: URL) {
  const pathname = url.pathname.toLowerCase();
  if (/\.jpe?g$/.test(pathname)) return "image/jpeg";
  if (/\.png$/.test(pathname)) return "image/png";
  if (/\.webp$/.test(pathname)) return "image/webp";
  if (/\.gif$/.test(pathname)) return "image/gif";
  if (/\.avif$/.test(pathname)) return "image/avif";
  if (/\.bmp$/.test(pathname)) return "image/bmp";
  return "";
}

function resolvedContentType(response: Response, url: URL) {
  const header = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (header && ALLOWED_CONTENT_TYPES.has(header)) return header;
  return inferredContentType(url);
}

async function fetchAllowedImage(startUrl: URL, withReferer: boolean) {
  let current = startUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const headers = withReferer
      ? { ...BROWSER_HEADERS, referer: "https://detail.1688.com/" }
      : BROWSER_HEADERS;
    const response = await fetch(current, {
      method: "GET",
      headers,
      redirect: "manual",
      cache: "force-cache",
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, finalUrl: current };
    }

    const location = response.headers.get("location");
    if (!location || redirectCount === MAX_REDIRECTS) {
      throw new Error("FREIGHT_IMAGE_REDIRECT_INVALID");
    }
    const redirected = new URL(location, current);
    const normalized = normalizeFreightImageUpstreamUrl(redirected.toString());
    if (!normalized || !isAllowedFreightImageHost(redirected.hostname)) {
      throw new Error("FREIGHT_IMAGE_REDIRECT_BLOCKED");
    }
    current = new URL(normalized);
  }

  throw new Error("FREIGHT_IMAGE_REDIRECT_LIMIT");
}

export async function GET(request: Request) {
  const rawUrl = new URL(request.url).searchParams.get("url");
  const normalized = normalizeFreightImageUpstreamUrl(rawUrl);
  if (!normalized) {
    return jsonError(
      400,
      "FREIGHT_IMAGE_URL_INVALID",
      "허용된 1688/Alibaba 이미지 주소가 필요합니다.",
    );
  }

  const startUrl = new URL(normalized);
  try {
    let result = await fetchAllowedImage(startUrl, true);
    if ([401, 403].includes(result.response.status)) {
      result = await fetchAllowedImage(startUrl, false);
    }

    const { response, finalUrl } = result;
    if (!response.ok || !response.body) {
      return jsonError(
        502,
        "FREIGHT_IMAGE_UPSTREAM_FAILED",
        `원본 이미지 서버가 응답하지 않았습니다. status=${response.status}`,
      );
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_CONTENT_LENGTH) {
      return jsonError(
        413,
        "FREIGHT_IMAGE_TOO_LARGE",
        "이미지 파일이 허용 크기를 초과했습니다.",
      );
    }

    const contentType = resolvedContentType(response, finalUrl);
    if (!contentType) {
      return jsonError(
        415,
        "FREIGHT_IMAGE_CONTENT_TYPE_INVALID",
        "원본 응답이 지원되는 이미지 형식이 아닙니다.",
      );
    }

    const headers = new Headers({
      "content-type": contentType,
      "cache-control":
        "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
      "content-disposition": "inline",
      "cross-origin-resource-policy": "same-origin",
      "x-content-type-options": "nosniff",
    });
    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");
    if (etag) headers.set("etag", etag);
    if (lastModified) headers.set("last-modified", lastModified);

    return new Response(response.body, { status: 200, headers });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return jsonError(
      timedOut ? 504 : 502,
      timedOut ? "FREIGHT_IMAGE_TIMEOUT" : "FREIGHT_IMAGE_PROXY_FAILED",
      timedOut
        ? "원본 이미지 서버 응답 시간이 초과됐습니다."
        : "이미지 중계 처리에 실패했습니다.",
    );
  }
}

import { timingSafeEqual } from "node:crypto";

export const RELIABILITY_INGEST_SECRET_HEADER =
  "x-commerce-os-reliability-secret";

function secretFromRequest(request: Request) {
  const header = request.headers.get(RELIABILITY_INGEST_SECRET_HEADER)?.trim();
  if (header) return header;
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function equalSecret(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function reliabilityIngestSecret() {
  return String(process.env.COMMERCE_OS_RELIABILITY_INGEST_SECRET ?? "").trim();
}

export function authorizeReliabilityIngest(
  request: Request,
  expectedSecret = reliabilityIngestSecret(),
): { ok: true } | { ok: false; code: string; message: string; status: number } {
  if (!expectedSecret) {
    return {
      ok: false,
      status: 503,
      code: "RELIABILITY_INGEST_UNCONFIGURED",
      message: "신뢰성 이벤트 수집 비밀키가 설정되지 않았습니다.",
    };
  }

  const suppliedSecret = secretFromRequest(request);
  if (!suppliedSecret || !equalSecret(suppliedSecret, expectedSecret)) {
    return {
      ok: false,
      status: 401,
      code: "RELIABILITY_INGEST_UNAUTHORIZED",
      message: "신뢰성 이벤트 수집 권한을 확인하지 못했습니다.",
    };
  }

  return { ok: true };
}

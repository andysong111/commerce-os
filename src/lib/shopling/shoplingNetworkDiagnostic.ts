import {
  buildShoplingReadRequestXml,
  shoplingReadConfigFromEnv,
} from "@/lib/shopling/shoplingReadClient";
import {
  postShoplingXml,
  type ShoplingTransportMode,
} from "@/lib/shopling/shoplingTlsTransport";

export type ShoplingNetworkDiagnosticResult = {
  checkedAt: string;
  resource: "orders";
  host: string;
  ok: boolean;
  elapsedMs: number;
  httpStatus: number | null;
  responseType: string | null;
  transportMode: ShoplingTransportMode | null;
  error: {
    name: string;
    code: string | null;
    message: string;
    errno: string | number | null;
    syscall: string | null;
    hostname: string | null;
    address: string | null;
    port: string | number | null;
  } | null;
  notice: string;
};

type UnknownRecord = Record<string, unknown>;

const MAX_TEXT = 240;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function safeText(value: unknown, secrets: string[] = []) {
  let output = String(value ?? "").replace(/[\r\n\t]+/g, " ").trim();
  for (const secret of secrets.filter(Boolean)) {
    output = output.split(secret).join("[redacted]");
  }
  output = output.replace(/https?:\/\/[^\s)]+/gi, (url) => {
    try {
      return new URL(url).origin;
    } catch {
      return "[url]";
    }
  });
  return output.slice(0, MAX_TEXT);
}

function safeScalar(value: unknown, secrets: string[] = []) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const output = safeText(value, secrets);
  return output || null;
}

export function sanitizeShoplingFetchError(
  error: unknown,
  secrets: string[] = [],
): ShoplingNetworkDiagnosticResult["error"] {
  const outer = record(error);
  const cause = record(outer.cause);
  const nestedCause = record(cause.cause);
  const source = Object.keys(nestedCause).length
    ? nestedCause
    : Object.keys(cause).length
      ? cause
      : outer;
  const message =
    safeText(source.message ?? outer.message ?? error, secrets) ||
    "Shopling network request failed";
  return {
    name: safeText(source.name ?? outer.name ?? "Error", secrets) || "Error",
    code: safeScalar(source.code ?? cause.code ?? outer.code, secrets) as
      | string
      | null,
    message,
    errno: safeScalar(source.errno ?? cause.errno ?? outer.errno, secrets),
    syscall: safeScalar(
      source.syscall ?? cause.syscall ?? outer.syscall,
      secrets,
    ) as string | null,
    hostname: safeScalar(
      source.hostname ?? cause.hostname ?? outer.hostname,
      secrets,
    ) as string | null,
    address: safeScalar(
      source.address ?? cause.address ?? outer.address,
      secrets,
    ) as string | null,
    port: safeScalar(source.port ?? cause.port ?? outer.port, secrets),
  };
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function runShoplingOrderNetworkDiagnostic(): Promise<ShoplingNetworkDiagnosticResult> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  const config = shoplingReadConfigFromEnv({
    SHOPLING_LOGIN_ID: process.env.SHOPLING_LOGIN_ID,
    SHOPLING_COMPANY_ID: process.env.SHOPLING_COMPANY_ID,
    SHOPLING_API_AUTH_KEY: process.env.SHOPLING_API_AUTH_KEY,
    SHOPLING_PRODUCTS_API_URL: process.env.SHOPLING_PRODUCTS_API_URL,
    SHOPLING_ORDERS_API_URL: process.env.SHOPLING_ORDERS_API_URL,
    SHOPLING_CLAIMS_API_URL: process.env.SHOPLING_CLAIMS_API_URL,
  });
  const url = new URL(config.ordersUrl);
  const day = dateOnly(new Date());
  const xml = buildShoplingReadRequestXml("orders", config, {
    start: day,
    end: day,
  });
  const secrets = [config.loginId, config.companyId, config.authKey];

  try {
    const response = await postShoplingXml(config.ordersUrl, xml, {
      headers: {
        accept: "application/xml, text/xml",
        "content-type": "application/xml; charset=utf-8",
        "user-agent": "commerce-os-ops-center-shopling-diagnostic/1.0",
      },
      timeoutMs: 20_000,
    });
    await response.text();
    return {
      checkedAt,
      resource: "orders",
      host: url.hostname,
      ok: true,
      elapsedMs: Date.now() - startedAt,
      httpStatus: response.status,
      responseType: response.headers.get("content-type"),
      transportMode: response.transportMode,
      error: null,
      notice:
        response.transportMode === "scoped_legacy_dh"
          ? "Shopling 서버 인증서를 검증하면서 이 호스트의 읽기 요청에만 제한적 DH 호환 전송을 적용해 연결했습니다. 응답 원문과 인증값은 표시하지 않았습니다."
          : "Shopling 주문 조회 호스트에 표준 HTTPS로 연결했습니다. 응답 원문과 인증값은 표시하지 않았습니다.",
    };
  } catch (error) {
    return {
      checkedAt,
      resource: "orders",
      host: url.hostname,
      ok: false,
      elapsedMs: Date.now() - startedAt,
      httpStatus: null,
      responseType: null,
      transportMode: null,
      error: sanitizeShoplingFetchError(error, secrets),
      notice:
        "Shopling 연결 실패 원인 중 DNS·TLS·연결·시간초과 관련 안전 필드만 표시합니다. 인증값과 요청·응답 원문은 제외했습니다.",
    };
  }
}

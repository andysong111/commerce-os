import { createHash } from "node:crypto";

const DEFAULT_CHINA_ORDER_BASE_URL =
  "https://china-order-manager.andy123df23.chatgpt.site";
const PROBE_BARCODE = "BGG1-1";
const INVALID_PROBE_TOKEN = "commerce-os-invalid-auth-layer-probe";

export type ChinaAuthLayerProbeState =
  | "CHATGPT_SITES_PLATFORM_GATE"
  | "APP_INTEGRATION_AUTH_REACHED"
  | "AUTH_BYPASS_RISK"
  | "UNEXPECTED_AUTH_SURFACE"
  | "NETWORK_BLOCKED"
  | "INVALID_BASE_URL";

export type ChinaAuthLayerProbe = {
  generatedAt: string;
  state: ChinaAuthLayerProbeState;
  message: string;
  baseHostname: string;
  baseOverrideConfigured: boolean;
  requestMethod: "GET";
  probeBarcode: string;
  invalidCredentialOnly: true;
  httpStatus: number | null;
  responseClass: "HTML" | "JSON" | "OTHER" | "NONE";
  finalHostname: string | null;
  platformSignInDetected: boolean;
  appIntegrationAuthDetected: boolean;
  responseBodyExposed: false;
  realSecretUsed: false;
  businessWritesEnabled: false;
  fingerprint: string;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function baseInfo() {
  const override = text(process.env.CHINA_ORDER_MANAGER_BASE_URL);
  const raw = override || DEFAULT_CHINA_ORDER_BASE_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") throw new Error("HTTPS_REQUIRED");
    return {
      ok: true as const,
      baseUrl: raw.replace(/\/$/, ""),
      hostname: url.hostname.toLowerCase(),
      overrideConfigured: Boolean(override),
    };
  } catch {
    return {
      ok: false as const,
      baseUrl: "",
      hostname: "INVALID",
      overrideConfigured: Boolean(override),
    };
  }
}

function responseClass(contentType: string) {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("text/html")) return "HTML" as const;
  if (
    normalized.includes("application/json") ||
    normalized.includes("application/problem+json")
  ) {
    return "JSON" as const;
  }
  return "OTHER" as const;
}

export async function loadChinaAuthLayerProbe(): Promise<ChinaAuthLayerProbe> {
  const base = baseInfo();
  if (!base.ok) {
    return result({
      state: "INVALID_BASE_URL",
      message: "중국 연동 base URL이 유효한 HTTPS 주소가 아니어서 인증계층 점검을 시작하지 않았습니다.",
      baseHostname: base.hostname,
      baseOverrideConfigured: base.overrideConfigured,
      httpStatus: null,
      responseClass: "NONE",
      finalHostname: null,
      platformSignInDetected: false,
      appIntegrationAuthDetected: false,
    });
  }

  try {
    const params = new URLSearchParams({
      barcodes: PROBE_BARCODE,
      limit: "1",
    });
    const response = await fetch(
      `${base.baseUrl}/api/integrations/confirmed-receipts-by-barcodes?${params.toString()}`,
      {
        method: "GET",
        headers: {
          accept: "application/json, text/html;q=0.8",
          authorization: `Bearer ${INVALID_PROBE_TOKEN}`,
          "user-agent": "commerce-os-china-auth-layer-probe/1.0",
        },
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    const kind = responseClass(contentType);
    const lower = body.toLowerCase();
    const platformSignInDetected =
      kind === "HTML" &&
      (lower.includes("chatgpt sites - sign in") ||
        (lower.includes("chatgpt sites") && lower.includes("sign in")));
    let appIntegrationAuthDetected = false;
    if (kind === "JSON") {
      try {
        const payload = JSON.parse(body) as Record<string, unknown>;
        const code = text(payload.code).toUpperCase();
        appIntegrationAuthDetected =
          code === "INVALID_PRICE_ADJUSTMENT_SECRET" ||
          code === "PRICE_ADJUSTMENT_SECRET_NOT_CONFIGURED";
      } catch {
        appIntegrationAuthDetected = false;
      }
    }
    let finalHostname: string | null = null;
    try {
      finalHostname = new URL(response.url).hostname.toLowerCase();
    } catch {
      finalHostname = null;
    }

    const state: ChinaAuthLayerProbeState =
      response.ok
        ? "AUTH_BYPASS_RISK"
        : platformSignInDetected
          ? "CHATGPT_SITES_PLATFORM_GATE"
          : appIntegrationAuthDetected
            ? "APP_INTEGRATION_AUTH_REACHED"
            : "UNEXPECTED_AUTH_SURFACE";
    const message =
      state === "CHATGPT_SITES_PLATFORM_GATE"
        ? "가짜 Bearer 토큰으로 읽기 전용 endpoint를 호출했을 때 앱의 integration-secret 검증보다 먼저 ChatGPT Sites 로그인 HTML이 반환되었습니다. 현재 hostname은 일반 서버간 Bearer 인증 표면으로 사용할 수 없습니다."
        : state === "APP_INTEGRATION_AUTH_REACHED"
          ? "가짜 Bearer 토큰이 앱의 integration-secret 검증까지 도달했습니다. 이 경우 플랫폼 로그인 계층이 아니라 양쪽 secret 정합성을 점검해야 합니다."
          : state === "AUTH_BYPASS_RISK"
            ? "의도적으로 잘못된 Bearer 토큰이 성공 응답을 받아 인증 우회 위험으로 분류했습니다. 실제 데이터는 사용하지 않고 연동을 차단해야 합니다."
            : "가짜 Bearer 토큰 요청이 예상한 Sites 로그인 또는 앱 integration 인증 응답과 일치하지 않아 인증 표면을 fail-closed로 분류했습니다.";

    return result({
      state,
      message,
      baseHostname: base.hostname,
      baseOverrideConfigured: base.overrideConfigured,
      httpStatus: response.status,
      responseClass: kind,
      finalHostname,
      platformSignInDetected,
      appIntegrationAuthDetected,
    });
  } catch {
    return result({
      state: "NETWORK_BLOCKED",
      message: "읽기 전용 인증계층 probe 자체가 네트워크 단계에서 완료되지 않았습니다. 실제 secret이나 사업데이터는 사용하지 않았습니다.",
      baseHostname: base.hostname,
      baseOverrideConfigured: base.overrideConfigured,
      httpStatus: null,
      responseClass: "NONE",
      finalHostname: null,
      platformSignInDetected: false,
      appIntegrationAuthDetected: false,
    });
  }
}

function result(input: {
  state: ChinaAuthLayerProbeState;
  message: string;
  baseHostname: string;
  baseOverrideConfigured: boolean;
  httpStatus: number | null;
  responseClass: ChinaAuthLayerProbe["responseClass"];
  finalHostname: string | null;
  platformSignInDetected: boolean;
  appIntegrationAuthDetected: boolean;
}): ChinaAuthLayerProbe {
  const stable = {
    state: input.state,
    baseHostname: input.baseHostname,
    baseOverrideConfigured: input.baseOverrideConfigured,
    httpStatus: input.httpStatus,
    responseClass: input.responseClass,
    finalHostname: input.finalHostname,
    platformSignInDetected: input.platformSignInDetected,
    appIntegrationAuthDetected: input.appIntegrationAuthDetected,
  };
  return {
    generatedAt: new Date().toISOString(),
    ...input,
    requestMethod: "GET",
    probeBarcode: PROBE_BARCODE,
    invalidCredentialOnly: true,
    responseBodyExposed: false,
    realSecretUsed: false,
    businessWritesEnabled: false,
    fingerprint: sha256(stable),
  };
}

import { createHash } from "node:crypto";
import { loadChinaConfirmedReceiptCoverage } from "@/lib/stage8ChinaConfirmedReceiptCoverage";

const DEFAULT_CHINA_ORDER_BASE_URL =
  "https://china-order-manager.andy123df23.chatgpt.site";

export type ChinaIntegrationBaseSource = "ENV_OVERRIDE" | "DEFAULT_CHATGPT_SITE";
export type ChinaIntegrationConfigAuditState =
  | "CONFIG_READY_SOURCE_READY"
  | "CONFIG_READY_SOURCE_BLOCKED"
  | "DEFAULT_CHATGPT_SITE_AUTH_BLOCKED"
  | "SECRET_NOT_CONFIGURED"
  | "INVALID_BASE_URL";

export type ChinaIntegrationSecretPresence = {
  name:
    | "CHINA_ORDER_MANAGER_INTEGRATION_SECRET"
    | "PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET"
    | "PRODUCT_MASTER_INTEGRATION_SECRET";
  configured: boolean;
};

export type ChinaIntegrationConfigAudit = {
  generatedAt: string;
  state: ChinaIntegrationConfigAuditState;
  message: string;
  baseSource: ChinaIntegrationBaseSource;
  baseHostname: string;
  baseProtocol: "https:" | "INVALID";
  baseIsChatgptSite: boolean;
  baseOverrideConfigured: boolean;
  configuredSecretCount: number;
  secretPresence: ChinaIntegrationSecretPresence[];
  sourceAuditState: string;
  sourceAvailable: boolean;
  sourceErrorCode: string | null;
  filterContractVerified: boolean;
  serverToServerAction:
    | "NONE"
    | "CONFIGURE_NON_SITES_BASE_OR_ACCESS"
    | "ALIGN_INTEGRATION_SECRET"
    | "CONFIGURE_SECRET"
    | "FIX_BASE_URL";
  fingerprint: string;
  secretValuesExposed: false;
  businessWritesEnabled: false;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim();
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function safeBaseInfo() {
  const override = text(process.env.CHINA_ORDER_MANAGER_BASE_URL);
  const raw = override || DEFAULT_CHINA_ORDER_BASE_URL;
  try {
    const url = new URL(raw);
    return {
      valid: url.protocol === "https:",
      hostname: url.hostname.toLowerCase(),
      protocol: url.protocol,
      overrideConfigured: Boolean(override),
      baseSource: override
        ? ("ENV_OVERRIDE" as const)
        : ("DEFAULT_CHATGPT_SITE" as const),
    };
  } catch {
    return {
      valid: false,
      hostname: "INVALID",
      protocol: "INVALID",
      overrideConfigured: Boolean(override),
      baseSource: override
        ? ("ENV_OVERRIDE" as const)
        : ("DEFAULT_CHATGPT_SITE" as const),
    };
  }
}

function secretPresence(): ChinaIntegrationSecretPresence[] {
  return [
    {
      name: "CHINA_ORDER_MANAGER_INTEGRATION_SECRET",
      configured: Boolean(text(process.env.CHINA_ORDER_MANAGER_INTEGRATION_SECRET)),
    },
    {
      name: "PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET",
      configured: Boolean(text(process.env.PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET)),
    },
    {
      name: "PRODUCT_MASTER_INTEGRATION_SECRET",
      configured: Boolean(text(process.env.PRODUCT_MASTER_INTEGRATION_SECRET)),
    },
  ];
}

export async function loadChinaIntegrationConfigAudit(): Promise<ChinaIntegrationConfigAudit> {
  const base = safeBaseInfo();
  const secrets = secretPresence();
  const configuredSecretCount = secrets.filter((row) => row.configured).length;
  const baseIsChatgptSite = base.hostname.endsWith(".chatgpt.site");

  let sourceAuditState = "NOT_ATTEMPTED";
  let sourceAvailable = false;
  let sourceErrorCode: string | null = null;
  let filterContractVerified = false;
  if (base.valid && configuredSecretCount > 0) {
    try {
      const source = await loadChinaConfirmedReceiptCoverage();
      sourceAuditState = source.state;
      sourceAvailable = source.sourceAvailable;
      sourceErrorCode = source.sourceErrorCode;
      filterContractVerified = source.filterContractVerified;
    } catch {
      sourceAuditState = "BLOCKED_SOURCE_AUDIT_ERROR";
      sourceAvailable = false;
      sourceErrorCode = "SOURCE_AUDIT_ERROR";
      filterContractVerified = false;
    }
  }

  let state: ChinaIntegrationConfigAuditState;
  let message: string;
  let serverToServerAction: ChinaIntegrationConfigAudit["serverToServerAction"];

  if (!base.valid) {
    state = "INVALID_BASE_URL";
    message = "중국 발주·입고 관리 base URL이 유효한 HTTPS 주소가 아니어서 서버간 연동을 차단합니다.";
    serverToServerAction = "FIX_BASE_URL";
  } else if (configuredSecretCount === 0) {
    state = "SECRET_NOT_CONFIGURED";
    message = "Ops Center에 중국 연동용으로 사용할 수 있는 기존 integration secret 이름이 하나도 설정되어 있지 않습니다. 값은 이 감사에서 읽거나 표시하지 않습니다.";
    serverToServerAction = "CONFIGURE_SECRET";
  } else if (
    baseIsChatgptSite &&
    sourceAvailable === false &&
    sourceErrorCode === "CHINA_RECEIPT_HISTORY_AUTH"
  ) {
    state = "DEFAULT_CHATGPT_SITE_AUTH_BLOCKED";
    message = "현재 중국 연동 base가 ChatGPT Site 계열이고 서버간 확정입고 조회가 인증 단계에서 차단됩니다. Site 로그인 계층과 별개로 접근 가능한 서버간 base/Access 경로가 필요합니다.";
    serverToServerAction = "CONFIGURE_NON_SITES_BASE_OR_ACCESS";
  } else if (sourceAvailable) {
    state = "CONFIG_READY_SOURCE_READY";
    message = "중국 연동 base와 기존 integration secret 구성이 서버간 읽기 전용 확정입고 조회까지 정상 연결됩니다.";
    serverToServerAction = "NONE";
  } else {
    state = "CONFIG_READY_SOURCE_BLOCKED";
    message = "중국 연동 base와 secret 이름은 구성되어 있지만 현재 읽기 전용 소스 인증 또는 접근이 완료되지 않았습니다. secret 값은 노출하지 않고 이름 존재 여부와 소스 상태만 확인했습니다.";
    serverToServerAction = "ALIGN_INTEGRATION_SECRET";
  }

  const stable = {
    state,
    baseSource: base.baseSource,
    baseHostname: base.hostname,
    baseProtocol: base.valid ? "https:" : "INVALID",
    baseIsChatgptSite,
    baseOverrideConfigured: base.overrideConfigured,
    configuredSecretNames: secrets
      .filter((row) => row.configured)
      .map((row) => row.name),
    sourceAuditState,
    sourceAvailable,
    sourceErrorCode,
    filterContractVerified,
    serverToServerAction,
  };

  return {
    generatedAt: new Date().toISOString(),
    state,
    message,
    baseSource: base.baseSource,
    baseHostname: base.hostname,
    baseProtocol: base.valid ? "https:" : "INVALID",
    baseIsChatgptSite,
    baseOverrideConfigured: base.overrideConfigured,
    configuredSecretCount,
    secretPresence: secrets,
    sourceAuditState,
    sourceAvailable,
    sourceErrorCode,
    filterContractVerified,
    serverToServerAction,
    fingerprint: sha256(stable),
    secretValuesExposed: false,
    businessWritesEnabled: false,
  };
}

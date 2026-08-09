const DEFAULT_CHINA_ORDER_BASE_URL =
  "https://china-order-manager.andy123df23.chatgpt.site";

export type HistoricalReceiptSourceReadiness = {
  configured: boolean;
  reachable: boolean;
  sourceMode: string | null;
  receiptRows: number;
  hasMore: boolean;
  hasNextSince: boolean;
  sourceWritesEnabled: false;
  statusCode: number;
  message: string;
};

function connection() {
  const secrets = [
    process.env.CHINA_ORDER_MANAGER_INTEGRATION_SECRET,
    process.env.PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET,
    process.env.PRODUCT_MASTER_INTEGRATION_SECRET,
  ]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
  const baseUrl = (
    process.env.CHINA_ORDER_MANAGER_BASE_URL?.trim() ||
    DEFAULT_CHINA_ORDER_BASE_URL
  ).replace(/\/$/, "");
  if (!secrets.length) throw new Error("CHINA_RECEIPT_INTEGRATION_SECRET_REQUIRED");
  if (!/^https:\/\//.test(baseUrl)) throw new Error("CHINA_ORDER_MANAGER_BASE_URL_INVALID");
  return { secrets, baseUrl };
}

export function historicalReceiptSourceConfigured() {
  try {
    connection();
    return true;
  } catch {
    return false;
  }
}

async function readSource(baseUrl: string, secret: string) {
  const response = await fetch(
    `${baseUrl}/api/integrations/price-adjustment-receipts?limit=5`,
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${secret}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { response, payload };
}

export async function loadHistoricalReceiptSourceReadiness(): Promise<HistoricalReceiptSourceReadiness> {
  const { secrets, baseUrl } = connection();
  let lastStatus = 0;
  let lastMessage = "AUTHENTICATED_SOURCE_NOT_REACHED";

  for (const secret of secrets) {
    const { response, payload } = await readSource(baseUrl, secret);
    lastStatus = response.status;
    lastMessage = String(payload.code || payload.message || `HTTP_${response.status}`);
    if (response.status === 401 || response.status === 403) continue;

    const rows = Array.isArray(payload.receipts) ? payload.receipts : [];
    const sourceMode = typeof payload.sourceMode === "string" ? payload.sourceMode : null;
    const sourceWritesEnabled = payload.sourceWritesEnabled === true;
    const validMode =
      sourceMode === "legacy_confirmed_batch" ||
      sourceMode === "immutable_inventory_movement";
    const reachable =
      response.ok &&
      payload.ok === true &&
      validMode &&
      !sourceWritesEnabled;
    return {
      configured: true,
      reachable,
      sourceMode,
      receiptRows: rows.length,
      hasMore: payload.hasMore === true,
      hasNextSince: Boolean(payload.nextSince),
      sourceWritesEnabled: false,
      statusCode: response.status,
      message: reachable
        ? "인증된 중국 발주 확정입고 원가 소스를 읽기 전용으로 확인했습니다."
        : lastMessage,
    };
  }

  return {
    configured: true,
    reachable: false,
    sourceMode: null,
    receiptRows: 0,
    hasMore: false,
    hasNextSince: false,
    sourceWritesEnabled: false,
    statusCode: lastStatus,
    message: lastMessage,
  };
}

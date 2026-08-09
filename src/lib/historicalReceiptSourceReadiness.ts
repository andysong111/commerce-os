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
  const secret = process.env.PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET?.trim();
  const baseUrl = (
    process.env.CHINA_ORDER_MANAGER_BASE_URL?.trim() ||
    DEFAULT_CHINA_ORDER_BASE_URL
  ).replace(/\/$/, "");
  if (!secret) throw new Error("PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET_REQUIRED");
  if (!/^https:\/\//.test(baseUrl)) throw new Error("CHINA_ORDER_MANAGER_BASE_URL_INVALID");
  return { secret, baseUrl };
}

export function historicalReceiptSourceConfigured() {
  try {
    connection();
    return true;
  } catch {
    return false;
  }
}

export async function loadHistoricalReceiptSourceReadiness(): Promise<HistoricalReceiptSourceReadiness> {
  const { secret, baseUrl } = connection();
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
      : String(payload.code || payload.message || `HTTP_${response.status}`),
  };
}

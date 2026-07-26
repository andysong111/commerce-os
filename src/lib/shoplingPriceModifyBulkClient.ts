export type ShoplingPriceBulkApiBody = Record<string, unknown>;

export class ShoplingPriceBulkApiError extends Error {
  readonly diagnosticText: string;

  constructor(message: string, diagnosticText: string) {
    super(message);
    this.name = "ShoplingPriceBulkApiError";
    this.diagnosticText = diagnosticText;
  }
}

export async function requestShoplingPriceBulkJson(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  operation: string,
): Promise<ShoplingPriceBulkApiBody> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : "네트워크 요청에 실패했습니다.";
    throw new ShoplingPriceBulkApiError(message, JSON.stringify({
      timestamp: new Date().toISOString(),
      operation,
      request_url: String(input),
      failure_type: "network_error",
      error: message,
    }, null, 2));
  }

  const rawText = await response.text();
  let body: ShoplingPriceBulkApiBody = {};
  if (rawText) {
    try {
      const parsed = JSON.parse(rawText) as unknown;
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as ShoplingPriceBulkApiBody
        : { response_body: parsed };
    } catch {
      body = { raw_response: rawText.slice(0, 4000) };
    }
  }

  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : `Bulk API 요청에 실패했습니다. HTTP ${response.status}`;
    throw new ShoplingPriceBulkApiError(message, JSON.stringify({
      timestamp: new Date().toISOString(),
      operation,
      request_url: response.url || String(input),
      http_status: response.status,
      http_status_text: response.statusText,
      api_code: typeof body.code === "string" ? body.code : null,
      api_stage: typeof body.stage === "string" ? body.stage : null,
      diagnostic_id: typeof body.diagnostic_id === "string" ? body.diagnostic_id : null,
      error: message,
      detail: typeof body.detail === "string" ? body.detail : body.detail ?? null,
      raw_response: body.raw_response ?? null,
    }, null, 2));
  }

  return body;
}

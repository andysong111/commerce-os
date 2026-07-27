export type ShoplingPriceBulkApiBody = Record<string, unknown>;

export const SHOPLING_PRICE_BULK_AUDIT_MAX_EVENTS = 20_000;
export const SHOPLING_PRICE_BULK_AUDIT_MAX_PAGES = 20;

export class ShoplingPriceBulkApiError extends Error {
  readonly diagnosticText: string;

  constructor(message: string, diagnosticText: string) {
    super(message);
    this.name = "ShoplingPriceBulkApiError";
    this.diagnosticText = diagnosticText;
  }
}

async function requestSingleShoplingPriceBulkJson(
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

function auditCollectionError(
  message: string,
  operation: string,
  requestUrl: string,
  detail: Record<string, unknown>,
): ShoplingPriceBulkApiError {
  return new ShoplingPriceBulkApiError(message, JSON.stringify({
    timestamp: new Date().toISOString(),
    operation,
    request_url: requestUrl,
    failure_type: "audit_pagination_guard",
    error: message,
    detail,
  }, null, 2));
}

function parseAuditCursor(
  value: unknown,
  operation: string,
  requestUrl: string,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const cursor = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(cursor) || cursor <= 0) {
    throw auditCollectionError("감사 로그 다음 페이지 커서가 올바르지 않습니다.", operation, requestUrl, { cursor: value ?? null });
  }
  return cursor;
}

function appendAuditEvents(
  target: Record<string, unknown>[],
  seenIds: Set<number>,
  value: unknown,
  operation: string,
  requestUrl: string,
) {
  if (!Array.isArray(value)) return;
  for (const event of value) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw auditCollectionError("감사 로그 이벤트 형식이 올바르지 않습니다.", operation, requestUrl, { event_type: typeof event });
    }
    const idValue = (event as { id?: unknown }).id;
    const id = typeof idValue === "number" ? idValue : Number(idValue);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw auditCollectionError("감사 로그 이벤트 ID가 올바르지 않습니다.", operation, requestUrl, { event_id: idValue ?? null });
    }
    if (seenIds.has(id)) continue;
    if (target.length >= SHOPLING_PRICE_BULK_AUDIT_MAX_EVENTS) {
      throw auditCollectionError("감사 로그 전체 조회가 20,000개 안전 한도를 초과했습니다.", operation, requestUrl, {
        max_events: SHOPLING_PRICE_BULK_AUDIT_MAX_EVENTS,
      });
    }
    seenIds.add(id);
    target.push(event as Record<string, unknown>);
  }
}

function addBeforeId(url: string, cursor: number) {
  const hashIndex = url.indexOf("#");
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}before_id=${encodeURIComponent(String(cursor))}${hash}`;
}

function auditRequestUrl(input: RequestInfo | URL, init: RequestInit | undefined, operation: string) {
  if (operation !== "bulk_ops.audit") return null;
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") return null;
  if (typeof input === "string") return input.includes("/audit") ? input : null;
  if (input instanceof URL) {
    const text = input.toString();
    return text.includes("/audit") ? text : null;
  }
  return null;
}

export async function requestShoplingPriceBulkJson(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  operation: string,
): Promise<ShoplingPriceBulkApiBody> {
  const first = await requestSingleShoplingPriceBulkJson(input, init, operation);
  const baseAuditUrl = auditRequestUrl(input, init, operation);
  if (!baseAuditUrl) return first;

  const events: Record<string, unknown>[] = [];
  const seenIds = new Set<number>();
  appendAuditEvents(events, seenIds, first.events, operation, baseAuditUrl);

  let pageCount = 1;
  let cursor = parseAuditCursor(first.next_before_id, operation, baseAuditUrl);
  let previousCursor: number | null = null;

  while (cursor !== null) {
    if (pageCount >= SHOPLING_PRICE_BULK_AUDIT_MAX_PAGES || events.length >= SHOPLING_PRICE_BULK_AUDIT_MAX_EVENTS) {
      throw auditCollectionError("감사 로그 전체 조회가 안전 페이지 한도에 도달했습니다. 다운로드를 중단했습니다.", operation, baseAuditUrl, {
        page_count: pageCount,
        event_count: events.length,
        max_pages: SHOPLING_PRICE_BULK_AUDIT_MAX_PAGES,
        max_events: SHOPLING_PRICE_BULK_AUDIT_MAX_EVENTS,
        next_before_id: cursor,
      });
    }
    if (previousCursor !== null && cursor >= previousCursor) {
      throw auditCollectionError("감사 로그 커서가 감소하지 않아 반복 조회를 차단했습니다.", operation, baseAuditUrl, {
        previous_cursor: previousCursor,
        next_cursor: cursor,
      });
    }

    previousCursor = cursor;
    const pageUrl = addBeforeId(baseAuditUrl, cursor);
    const page = await requestSingleShoplingPriceBulkJson(pageUrl, init, `${operation}.page_${pageCount + 1}`);
    appendAuditEvents(events, seenIds, page.events, operation, pageUrl);
    pageCount += 1;

    const nextCursor = parseAuditCursor(page.next_before_id, operation, pageUrl);
    if (nextCursor !== null && nextCursor >= cursor) {
      throw auditCollectionError("감사 로그 다음 페이지 커서가 이전 커서보다 작지 않습니다.", operation, pageUrl, {
        current_cursor: cursor,
        next_cursor: nextCursor,
      });
    }
    cursor = nextCursor;
  }

  return {
    ...first,
    events,
    next_before_id: null,
    audit_page_count: pageCount,
    audit_truncated: false,
  };
}

import {
  buildShoplingReadRequestXml,
  parseShoplingReadResponse,
  shoplingReadConfigFromEnv,
  type ShoplingDateRange,
} from "@/lib/shopling/shoplingReadClient";
import { postShoplingXml } from "@/lib/shopling/shoplingTlsTransport";
import {
  createSupabaseAdminClient,
  createSupabaseAdminHeaders,
} from "@/lib/supabase/admin";

export const PRODUCT_MASTER_SHOPLING_ORDER_PROBE =
  "PRODUCT_MASTER_SHOPLING_ORDER_PROBE";

const MAX_SAFE_MESSAGE_LENGTH = 500;
const MAX_TAG_SUMMARY = 30;
const MAX_FIELD_SUMMARY = 30;
const PROBE_WINDOW_DAYS = 7;
const PROBE_COOLDOWN_MS = 6 * 60 * 60 * 1_000;

type ProbeCategory =
  | "SUCCESS_ROWS"
  | "SUCCESS_EMPTY"
  | "CONFIGURATION"
  | "TIMEOUT"
  | "DNS"
  | "TLS"
  | "NETWORK"
  | "HTTP"
  | "SHOPLING_RESPONSE"
  | "PARSE"
  | "UNKNOWN";

export type ShoplingOrderProbeTag = {
  name: string;
  count: number;
};

export type ProductMasterShoplingOrderProbeResult = {
  probeId: string;
  attemptedAt: string;
  startDate: string;
  endDate: string;
  ok: boolean;
  category: ProbeCategory;
  code: string;
  safeMessage: string;
  durationMs: number;
  httpStatus: number | null;
  contentType: string | null;
  responseBytes: number;
  parsedRowCount: number;
  expectedContainerTagCount: number;
  expectedRowTagCount: number;
  tagSummary: ShoplingOrderProbeTag[];
  parsedFieldNames: string[];
  evidenceStored: boolean;
  sourceWritesEnabled: false;
};

type OperationRow = {
  result_snapshot?: unknown;
};

function shoplingEnvironment() {
  return {
    SHOPLING_LOGIN_ID: process.env.SHOPLING_LOGIN_ID,
    SHOPLING_COMPANY_ID: process.env.SHOPLING_COMPANY_ID,
    SHOPLING_API_AUTH_KEY: process.env.SHOPLING_API_AUTH_KEY,
    SHOPLING_PRODUCTS_API_URL: process.env.SHOPLING_PRODUCTS_API_URL,
    SHOPLING_ORDERS_API_URL: process.env.SHOPLING_ORDERS_API_URL,
    SHOPLING_CLAIMS_API_URL: process.env.SHOPLING_CLAIMS_API_URL,
  };
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validDateOnly(value: string) {
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
  );
}

function koreaDate() {
  return new Date(Date.now() + 9 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
}

function addDays(value: string, days: number) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function defaultRange(): ShoplingDateRange {
  const end = koreaDate();
  return { start: addDays(end, -(PROBE_WINDOW_DAYS - 1)), end };
}

function redact(value: unknown) {
  let message = text(value);
  const secrets = [
    process.env.SHOPLING_API_AUTH_KEY,
    process.env.SHOPLING_LOGIN_ID,
    process.env.SHOPLING_COMPANY_ID,
  ]
    .map((secret) => secret?.trim())
    .filter((secret): secret is string => Boolean(secret));
  for (const secret of secrets) {
    message = message.replaceAll(secret, "[REDACTED]");
  }
  message = message
    .replace(/https?:\/\/[^\s)]+/gi, "[URL]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(
      /(api[_-]?auth[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    );
  return message.slice(0, MAX_SAFE_MESSAGE_LENGTH);
}

function errorEvidence(error: unknown) {
  const messages: string[] = [];
  const codes: string[] = [];
  const names: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof Error) {
      if (current.message) messages.push(current.message);
      if (current.name) names.push(current.name);
      const record = current as Error & { code?: unknown; cause?: unknown };
      if (record.code) codes.push(text(record.code));
      current = record.cause;
      continue;
    }
    const record = asRecord(current);
    if (record.message) messages.push(text(record.message));
    if (record.name) names.push(text(record.name));
    if (record.code) codes.push(text(record.code));
    current = record.cause;
  }
  return {
    code: codes.find(Boolean) || names.find(Boolean) || "UNKNOWN_ERROR",
    message:
      redact(
        [...new Set([...codes, ...names, ...messages])]
          .filter(Boolean)
          .join(" · "),
      ) || "Shopling 주문 읽기 진단 중 알 수 없는 오류가 발생했습니다.",
  };
}

function classify(code: string, message: string): ProbeCategory {
  const combined = `${code} ${message}`.toUpperCase();
  if (/SHOPLING_CREDENTIAL_REQUIRED|NOT_CONFIGURED/.test(combined)) {
    return "CONFIGURATION";
  }
  if (/TIMEOUT|ETIMEDOUT|ABORT_ERR|UND_ERR_CONNECT_TIMEOUT/.test(combined)) {
    return "TIMEOUT";
  }
  if (/ENOTFOUND|EAI_AGAIN|DNS/.test(combined)) return "DNS";
  if (/CERT|TLS|SSL|EPROTO|UNABLE_TO_VERIFY|SELF_SIGNED/.test(combined)) {
    return "TLS";
  }
  if (/ECONNRESET|ECONNREFUSED|EPIPE|NETWORK|FETCH FAILED/.test(combined)) {
    return "NETWORK";
  }
  if (/SHOPLING_ORDERS_HTTP_|HTTP_\d{3}/.test(combined)) return "HTTP";
  if (/SHOPLING_ORDERS_RESPONSE_ERROR/.test(combined)) {
    return "SHOPLING_RESPONSE";
  }
  if (/INVALID_RESPONSE|PARSE|XML/.test(combined)) return "PARSE";
  return "UNKNOWN";
}

function safeTagSummary(body: string): ShoplingOrderProbeTag[] {
  const counts = new Map<string, number>();
  const tagRegex = /<([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s[^<>]*?)?>/g;
  for (const match of body.matchAll(tagRegex)) {
    const name = match[1]?.trim();
    if (!name || name.startsWith("?")) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, MAX_TAG_SUMMARY);
}

function tagCount(body: string, tagName: string) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<${escaped}(?:\\s[^<>]*?)?>`, "g");
  return [...body.matchAll(regex)].length;
}

function parsedFieldNames(rows: unknown[]) {
  const names = new Set<string>();
  for (const row of rows.slice(0, 20)) {
    for (const key of Object.keys(asRecord(row))) names.add(key);
  }
  return [...names].sort().slice(0, MAX_FIELD_SUMMARY);
}

function supabaseConnection() {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const secret = (
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();
  if (!baseUrl || !secret) return null;
  return { baseUrl, secret };
}

async function storeProbeEvidence(result: ProductMasterShoplingOrderProbeResult) {
  const runtime = supabaseConnection();
  if (!runtime) return false;
  try {
    const response = await fetch(
      `${runtime.baseUrl}/rest/v1/commerce_operation_runs?select=id`,
      {
        method: "POST",
        headers: {
          ...createSupabaseAdminHeaders(runtime.secret),
          Prefer: "return=minimal",
        },
        body: JSON.stringify([
          {
            operation_type: PRODUCT_MASTER_SHOPLING_ORDER_PROBE,
            status: result.ok ? "SUCCEEDED" : "FAILED",
            source: "ops-center-product-master-shopling-order-probe",
            source_event_id: `product-master-shopling-order-probe:${result.probeId}`,
            correlation_id: `product-master-shopling-order-probe:${result.probeId}`,
            actor_type: "SYSTEM",
            input_snapshot: {
              resource: "orders",
              startDate: result.startDate,
              endDate: result.endDate,
              rangeDays: PROBE_WINDOW_DAYS,
            },
            result_snapshot: { ...result, evidenceStored: true },
            error_message: result.ok ? null : result.safeMessage,
            started_at: result.attemptedAt,
            finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function runProductMasterShoplingOrderProbe(
  requestedRange?: Partial<ShoplingDateRange>,
): Promise<ProductMasterShoplingOrderProbeResult> {
  const fallback = defaultRange();
  const startDate = text(requestedRange?.start) || fallback.start;
  const endDate = text(requestedRange?.end) || fallback.end;
  if (!validDateOnly(startDate) || !validDateOnly(endDate) || startDate > endDate) {
    throw new Error("SHOPLING_ORDER_PROBE_DATE_INVALID");
  }
  const inclusiveDays =
    Math.floor(
      (Date.parse(`${endDate}T00:00:00.000Z`) -
        Date.parse(`${startDate}T00:00:00.000Z`)) /
        86_400_000,
    ) + 1;
  if (inclusiveDays < 1 || inclusiveDays > PROBE_WINDOW_DAYS) {
    throw new Error("SHOPLING_ORDER_PROBE_RANGE_TOO_WIDE");
  }

  const probeId = crypto.randomUUID();
  const attemptedAt = new Date().toISOString();
  const startedAt = Date.now();
  let result: ProductMasterShoplingOrderProbeResult;

  try {
    const config = shoplingReadConfigFromEnv(shoplingEnvironment());
    const xml = buildShoplingReadRequestXml(
      "orders",
      config,
      { start: startDate, end: endDate },
    );
    const response = await postShoplingXml(config.ordersUrl, xml, {
      headers: {
        accept: "application/xml, text/xml",
        "content-type": "application/xml; charset=utf-8",
        "user-agent": "commerce-os-ops-center-shopling-order-probe/1.0",
      },
      timeoutMs: 30_000,
    });
    const body = await response.text();
    const contentType = response.headers.get("content-type");
    const responseBytes = Buffer.byteLength(body, "utf8");
    const tags = safeTagSummary(body);
    const expectedContainerTagCount = tagCount(body, "apiOrdGatherRst");
    const expectedRowTagCount = tagCount(body, "ordListRst");

    if (!response.ok) {
      const code = `SHOPLING_ORDERS_HTTP_${response.status}`;
      result = {
        probeId,
        attemptedAt,
        startDate,
        endDate,
        ok: false,
        category: "HTTP",
        code,
        safeMessage: code,
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        contentType,
        responseBytes,
        parsedRowCount: 0,
        expectedContainerTagCount,
        expectedRowTagCount,
        tagSummary: tags,
        parsedFieldNames: [],
        evidenceStored: false,
        sourceWritesEnabled: false,
      };
    } else {
      const rows = parseShoplingReadResponse("orders", body);
      const parsedRowCount = Array.isArray(rows) ? rows.length : 0;
      result = {
        probeId,
        attemptedAt,
        startDate,
        endDate,
        ok: true,
        category: parsedRowCount > 0 ? "SUCCESS_ROWS" : "SUCCESS_EMPTY",
        code:
          parsedRowCount > 0
            ? "SHOPLING_ORDERS_PROBE_ROWS_OK"
            : "SHOPLING_ORDERS_PROBE_EMPTY",
        safeMessage:
          parsedRowCount > 0
            ? `Shopling 주문 API 최근 ${inclusiveDays}일 범위에서 ${parsedRowCount}개 응답행을 안전하게 확인했습니다.`
            : `Shopling 주문 API는 HTTP 성공했지만 최근 ${inclusiveDays}일 범위에서 파서가 주문행을 0개 확인했습니다. 응답 태그 구조 증거를 함께 기록했습니다.`,
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
        contentType,
        responseBytes,
        parsedRowCount,
        expectedContainerTagCount,
        expectedRowTagCount,
        tagSummary: tags,
        parsedFieldNames: Array.isArray(rows) ? parsedFieldNames(rows) : [],
        evidenceStored: false,
        sourceWritesEnabled: false,
      };
    }
  } catch (error) {
    const evidence = errorEvidence(error);
    result = {
      probeId,
      attemptedAt,
      startDate,
      endDate,
      ok: false,
      category: classify(evidence.code, evidence.message),
      code: evidence.code,
      safeMessage: evidence.message,
      durationMs: Date.now() - startedAt,
      httpStatus: null,
      contentType: null,
      responseBytes: 0,
      parsedRowCount: 0,
      expectedContainerTagCount: 0,
      expectedRowTagCount: 0,
      tagSummary: [],
      parsedFieldNames: [],
      evidenceStored: false,
      sourceWritesEnabled: false,
    };
  }

  result.evidenceStored = await storeProbeEvidence(result);
  return result;
}

function normalizeStoredResult(value: unknown) {
  const result = asRecord(value) as Partial<ProductMasterShoplingOrderProbeResult>;
  if (
    !text(result.probeId) ||
    !text(result.attemptedAt) ||
    !text(result.startDate) ||
    !text(result.endDate) ||
    typeof result.ok !== "boolean" ||
    result.sourceWritesEnabled !== false
  ) {
    return null;
  }
  return result as ProductMasterShoplingOrderProbeResult;
}

export async function loadLatestProductMasterShoplingOrderProbe() {
  const admin = await createSupabaseAdminClient();
  if (!admin) return null;
  const query = await admin
    .from("commerce_operation_runs")
    .select("result_snapshot")
    .eq("operation_type", PRODUCT_MASTER_SHOPLING_ORDER_PROBE)
    .order("started_at", { ascending: false })
    .limit(1);
  if (query.error) throw new Error(query.error.message);
  const rows = (Array.isArray(query.data) ? query.data : []) as OperationRow[];
  return normalizeStoredResult(rows[0]?.result_snapshot);
}

export async function ensureProductMasterShoplingOrderProbe() {
  const latest = await loadLatestProductMasterShoplingOrderProbe();
  if (latest) {
    const age = Date.now() - Date.parse(latest.attemptedAt);
    if (Number.isFinite(age) && age >= 0 && age < PROBE_COOLDOWN_MS) {
      return { executed: false as const, result: latest };
    }
  }
  return {
    executed: true as const,
    result: await runProductMasterShoplingOrderProbe(),
  };
}

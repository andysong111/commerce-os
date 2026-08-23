import { createHash } from "node:crypto";

export const RELIABILITY_STATUSES = [
  "started",
  "progress",
  "succeeded",
  "failed",
  "blocked",
  "retrying",
  "quality_rejected",
  "recovered",
  "canceled",
] as const;

export const RELIABILITY_SEVERITIES = [
  "info",
  "warning",
  "error",
  "critical",
] as const;

export const RELIABILITY_RISK_LEVELS = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

export type ReliabilityStatus = (typeof RELIABILITY_STATUSES)[number];
export type ReliabilitySeverity = (typeof RELIABILITY_SEVERITIES)[number];
export type ReliabilityRiskLevel = (typeof RELIABILITY_RISK_LEVELS)[number];

export type ReliabilityEventInput = {
  event_id?: unknown;
  schema_version?: unknown;
  source_system?: unknown;
  engine?: unknown;
  event_type?: unknown;
  status?: unknown;
  severity?: unknown;
  risk_level?: unknown;
  run_id?: unknown;
  correlation_id?: unknown;
  incident_signature?: unknown;
  stage?: unknown;
  error_code?: unknown;
  error_message?: unknown;
  duration_ms?: unknown;
  retry_count?: unknown;
  automatic_recovery?: unknown;
  recovery_action?: unknown;
  quality_signals?: unknown;
  metrics?: unknown;
  metadata?: unknown;
  occurred_at?: unknown;
};

export type NormalizedReliabilityEvent = {
  event_id: string;
  schema_version: number;
  source_system: string;
  engine: string;
  event_type: string;
  status: ReliabilityStatus;
  severity: ReliabilitySeverity;
  risk_level: ReliabilityRiskLevel;
  run_id?: string;
  correlation_id: string;
  incident_signature?: string;
  stage?: string;
  error_code?: string;
  error_message?: string;
  duration_ms?: number;
  retry_count: number;
  automatic_recovery: boolean;
  recovery_action?: string;
  quality_signals: Record<string, unknown>;
  metrics: Record<string, unknown>;
  metadata: Record<string, unknown>;
  occurred_at: string;
};

const SENSITIVE_KEY = /(?:^|_)(?:email|e_mail|user_id|userid|owner_id|owneremail|owner_email|source_url|sourceurl|product_name|productname|input_payload|output_payload|raw|prompt|image|images|image_base64|storage_path|authorization|cookie|token|secret|password|phone|address)(?:$|_)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL = /https?:\/\/[^\s)\]}>'"]+/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const LONG_SECRET = /\b(?:sk|sb_secret|eyJ)[A-Za-z0-9._-]{16,}\b/g;
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:/-]+$/;
const FAILURE_STATUSES = new Set<ReliabilityStatus>([
  "failed",
  "blocked",
  "retrying",
  "quality_rejected",
]);

function text(value: unknown, max: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function redactReliabilityText(value: unknown, max = 2_000) {
  return text(value, max * 2)
    .replace(EMAIL, "[redacted-email]")
    .replace(URL, "[redacted-url]")
    .replace(BEARER, "Bearer [redacted]")
    .replace(LONG_SECRET, "[redacted-secret]")
    .slice(0, max);
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback?: T[number],
): T[number] {
  const normalized = text(value, 80).toLowerCase();
  if ((allowed as readonly string[]).includes(normalized)) {
    return normalized as T[number];
  }
  if (fallback !== undefined) return fallback;
  throw new TypeError(`지원하지 않는 신뢰성 이벤트 값입니다: ${normalized || "(비어 있음)"}`);
}

function nonNegativeInteger(
  value: unknown,
  fallback = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(max, Math.trunc(parsed)));
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth-limited]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return redactReliabilityText(value, 500);
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  }
  if (!value || typeof value !== "object") return null;

  const result: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(
    value as Record<string, unknown>,
  ).slice(0, 100)) {
    const key = text(rawKey, 100);
    if (!key) continue;
    if (SENSITIVE_KEY.test(key)) {
      result[key] = "[redacted]";
      continue;
    }
    result[key] = sanitizeValue(rawValue, depth + 1);
  }
  return result;
}

export function sanitizeReliabilityJson(value: unknown, maxBytes = 16_000) {
  const sanitized = sanitizeValue(value);
  const object =
    sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
      ? (sanitized as Record<string, unknown>)
      : {};
  try {
    const serialized = JSON.stringify(object);
    if (Buffer.byteLength(serialized, "utf8") <= maxBytes) return object;
  } catch {
    return {};
  }
  return { truncated: true };
}

function stableHash(parts: readonly unknown[]) {
  return createHash("sha256")
    .update(parts.map((part) => text(part, 500)).join("\u001f"))
    .digest("hex")
    .slice(0, 24);
}

export function buildReliabilityIncidentSignature(input: {
  sourceSystem: string;
  engine: string;
  errorCode?: string;
  stage?: string;
  status: ReliabilityStatus;
}) {
  const readableCode =
    text(input.errorCode || input.status, 100)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unknown";
  const hash = stableHash([
    input.sourceSystem,
    input.engine,
    input.errorCode || input.status,
    input.stage || "",
  ]);
  return `${text(input.sourceSystem, 60)}:${text(input.engine, 80)}:${readableCode}:${hash}`.slice(
    0,
    300,
  );
}

function isoDate(value: unknown) {
  const parsed = Date.parse(text(value, 100));
  return Number.isFinite(parsed)
    ? new Date(parsed).toISOString()
    : new Date().toISOString();
}

export function normalizeReliabilityEvent(
  input: ReliabilityEventInput,
): NormalizedReliabilityEvent {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("신뢰성 이벤트 본문은 객체여야 합니다.");
  }

  const sourceSystem = text(input.source_system, 120);
  const engine = text(input.engine, 160);
  if (!sourceSystem || !engine) {
    throw new TypeError("source_system과 engine은 필수입니다.");
  }

  const status = enumValue(input.status, RELIABILITY_STATUSES);
  const severity = enumValue(
    input.severity,
    RELIABILITY_SEVERITIES,
    FAILURE_STATUSES.has(status) ? "warning" : "info",
  );
  const riskLevel = enumValue(
    input.risk_level,
    RELIABILITY_RISK_LEVELS,
    "low",
  );
  const runId = text(input.run_id, 300);
  const stage = text(input.stage, 160);
  const errorCode = text(input.error_code, 160);
  const occurredAt = isoDate(input.occurred_at);

  let eventId = text(input.event_id, 300);
  if (!eventId) {
    eventId = `evt:${stableHash([
      sourceSystem,
      engine,
      runId,
      status,
      stage,
      errorCode,
      occurredAt,
    ])}`;
  }
  if (!EVENT_ID_PATTERN.test(eventId)) {
    throw new TypeError(
      "event_id에는 영문, 숫자, 점, 밑줄, 콜론, 슬래시, 하이픈만 사용할 수 있습니다.",
    );
  }

  const explicitSignature = text(input.incident_signature, 300);
  const incidentSignature =
    explicitSignature ||
    (FAILURE_STATUSES.has(status)
      ? buildReliabilityIncidentSignature({
          sourceSystem,
          engine,
          errorCode,
          stage,
          status,
        })
      : "");
  const correlationId = text(input.correlation_id, 300) || runId || eventId;
  const errorMessage = redactReliabilityText(input.error_message, 2_000);
  const recoveryAction = text(input.recovery_action, 160);

  return {
    event_id: eventId,
    schema_version: Math.max(
      1,
      Math.min(100, nonNegativeInteger(input.schema_version, 1, 100)),
    ),
    source_system: sourceSystem,
    engine,
    event_type: text(input.event_type, 160) || "run.status",
    status,
    severity,
    risk_level: riskLevel,
    ...(runId ? { run_id: runId } : {}),
    correlation_id: correlationId,
    ...(incidentSignature ? { incident_signature: incidentSignature } : {}),
    ...(stage ? { stage } : {}),
    ...(errorCode ? { error_code: errorCode } : {}),
    ...(errorMessage ? { error_message: errorMessage } : {}),
    ...(input.duration_ms === undefined
      ? {}
      : { duration_ms: nonNegativeInteger(input.duration_ms, 0) }),
    retry_count: nonNegativeInteger(input.retry_count, 0, 10_000),
    automatic_recovery: input.automatic_recovery === true,
    ...(recoveryAction ? { recovery_action: recoveryAction } : {}),
    quality_signals: sanitizeReliabilityJson(input.quality_signals),
    metrics: sanitizeReliabilityJson(input.metrics),
    metadata: sanitizeReliabilityJson(input.metadata),
    occurred_at: occurredAt,
  };
}

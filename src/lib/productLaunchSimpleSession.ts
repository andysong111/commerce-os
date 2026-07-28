import { extractUploadRows, extractRowsWithGoodsKey } from "./productLaunchFlow";
import type { KeywordRecommendationGroup } from "./productLaunchKeywordRecommendations";

export const PRODUCT_LAUNCH_SIMPLE_SESSION_KEY =
  "productLaunchFlow.simpleSession.v1";

export type ProductLaunchSimpleRunResult = {
  status?: string;
  phase?: string;
  message?: string;
  requestId?: string;
  githubActionsUrl?: string;
  runUrl?: string;
  runStatus?: string;
  runConclusion?: string | null;
  summary?: Record<string, unknown>;
  applyResults?: Array<Record<string, unknown>>;
  blockedItems?: Array<Record<string, unknown>>;
  recommendations?: KeywordRecommendationGroup[];
  goodsKeys?: string[];
  engineStatus?: string;
  artifactId?: number;
};

export type ProductLaunchSimpleSession = {
  version: 1;
  rowExpression: string;
  uploadRequestId: string;
  uploadResult: ProductLaunchSimpleRunResult | null;
  uploadPolls: number;
  priceRequestId: string;
  priceResult: ProductLaunchSimpleRunResult | null;
  pricePolls: number;
  recommendationRequestId: string;
  recommendationResult: ProductLaunchSimpleRunResult | null;
  recommendationPolls: number;
  titles: Record<string, string>;
  searches: Record<string, string>;
  directRequestId: string;
  directResult: ProductLaunchSimpleRunResult | null;
  directPolls: number;
  updatedAt: string;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const FAILED_STATUSES = new Set([
  "failed",
  "failure",
  "error",
  "partial_failure",
  "partial failure",
  "cancelled",
  "canceled",
  "timed_out",
  "timed out",
  "action_required",
]);

function text(value: unknown) {
  return String(value ?? "").trim();
}

function status(value: unknown) {
  return text(value).toLocaleLowerCase().replace(/[\s-]+/g, "_");
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringMap(value: unknown) {
  const source = object(value);
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, item]) => [key.trim(), text(item)] as const)
      .filter(([key]) => key),
  );
}

function safePollCount(value: unknown) {
  return Math.max(0, Math.min(1000, Math.trunc(number(value))));
}

function safeResult(value: unknown): ProductLaunchSimpleRunResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as ProductLaunchSimpleRunResult;
  return JSON.parse(JSON.stringify(source)) as ProductLaunchSimpleRunResult;
}

export function isSuccessfulSimpleUploadResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as ProductLaunchSimpleRunResult;
  const summary = object(result.summary);
  const outerStatus = status(result.status);
  const summaryStatus = status(summary.status);
  const runConclusion = status(result.runConclusion);
  const phase = status(result.phase);
  const failureCount = number(
    summary.fail_count ??
      summary.failed_count ??
      summary.failure_count ??
      summary.error_count,
  );
  const exitCode = summary.exit_code;
  const rows = extractUploadRows(result);
  const rowsWithGoodsKey = extractRowsWithGoodsKey(result);
  const hasExplicitFailedRow = rows.some((row) => {
    const rowStatus = status(row.status);
    const code = status(row.code);
    return (
      row.success === false ||
      row.ok === false ||
      FAILED_STATUSES.has(rowStatus) ||
      FAILED_STATUSES.has(code) ||
      !text(row.goods_key)
    );
  });

  if (FAILED_STATUSES.has(outerStatus) || FAILED_STATUSES.has(summaryStatus))
    return false;
  if (runConclusion && runConclusion !== "success") return false;
  if (phase && phase !== "artifact_ready" && phase !== "success") return false;
  if (summaryStatus !== "success") return false;
  if (failureCount !== 0) return false;
  if (exitCode !== undefined && number(exitCode) !== 0) return false;
  if (rows.length < 1 || rowsWithGoodsKey.length < 1) return false;
  if (hasExplicitFailedRow) return false;
  return true;
}

export function createEmptyProductLaunchSimpleSession(
  now = new Date(),
): ProductLaunchSimpleSession {
  return {
    version: 1,
    rowExpression: "",
    uploadRequestId: "",
    uploadResult: null,
    uploadPolls: 0,
    priceRequestId: "",
    priceResult: null,
    pricePolls: 0,
    recommendationRequestId: "",
    recommendationResult: null,
    recommendationPolls: 0,
    titles: {},
    searches: {},
    directRequestId: "",
    directResult: null,
    directPolls: 0,
    updatedAt: now.toISOString(),
  };
}

export function parseProductLaunchSimpleSession(
  value: unknown,
): ProductLaunchSimpleSession | null {
  const source = object(value);
  if (source.version !== 1) return null;
  const directRequestId = text(source.directRequestId);
  const hasRecommendationFields =
    Object.hasOwn(source, "recommendationRequestId") ||
    Object.hasOwn(source, "recommendationResult") ||
    Object.hasOwn(source, "recommendationPolls");
  const legacyRecommendationResult =
    directRequestId && !hasRecommendationFields
      ? {
          status: "skipped",
          phase: "artifact_ready",
          message:
            "기존 버전에서 이미 상품명·검색어 반영을 시작한 작업이므로 추천 단계는 건너뛰었습니다.",
        }
      : null;
  return {
    version: 1,
    rowExpression: text(source.rowExpression),
    uploadRequestId: text(source.uploadRequestId),
    uploadResult: safeResult(source.uploadResult),
    uploadPolls: safePollCount(source.uploadPolls),
    priceRequestId: text(source.priceRequestId),
    priceResult: safeResult(source.priceResult),
    pricePolls: safePollCount(source.pricePolls),
    recommendationRequestId: text(source.recommendationRequestId),
    recommendationResult:
      safeResult(source.recommendationResult) ?? legacyRecommendationResult,
    recommendationPolls: safePollCount(source.recommendationPolls),
    titles: stringMap(source.titles),
    searches: stringMap(source.searches),
    directRequestId,
    directResult: safeResult(source.directResult),
    directPolls: safePollCount(source.directPolls),
    updatedAt: text(source.updatedAt) || new Date(0).toISOString(),
  };
}

export function readProductLaunchSimpleSession(storage: StorageLike) {
  try {
    const raw = storage.getItem(PRODUCT_LAUNCH_SIMPLE_SESSION_KEY);
    if (!raw) return null;
    return parseProductLaunchSimpleSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeProductLaunchSimpleSession(
  storage: StorageLike,
  session: ProductLaunchSimpleSession,
) {
  storage.setItem(
    PRODUCT_LAUNCH_SIMPLE_SESSION_KEY,
    JSON.stringify({ ...session, version: 1 }),
  );
}

export function clearProductLaunchSimpleSession(storage: StorageLike) {
  storage.removeItem(PRODUCT_LAUNCH_SIMPLE_SESSION_KEY);
}

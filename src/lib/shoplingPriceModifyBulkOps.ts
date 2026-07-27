import {
  parseShoplingPriceBulkPaste,
  plannedShoplingPriceBulkChunkCount,
} from "@/lib/shoplingPriceModifyBulkInput";

export type ShoplingPriceBulkOpsItem = {
  goods_key: string;
  ordinal: number;
  status: string;
  attempt_count: number;
  last_error?: string | null;
};

export type ShoplingPriceBulkOpsChunk = {
  chunk_index: number;
  chunk_type: string;
  status: string;
  goods_key_count: number;
  attempt_count: number;
  retry_round?: number | null;
  request_id?: string | null;
  actions_url?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  last_error?: string | null;
};

const ACTIVE_JOB_STATUSES = new Set([
  "canary_dispatching",
  "canary_running",
  "normal_running",
  "retry_running",
  "dispatch_uncertain",
]);

const toMillis = (value: unknown) => {
  if (typeof value !== "string" || !value) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
};

export function calculateShoplingPriceBulkTiming(
  job: Record<string, unknown>,
  chunks: ShoplingPriceBulkOpsChunk[],
  succeededItems: number,
  now: () => number = () => Date.now(),
) {
  const startedValues = chunks.map((chunk) => toMillis(chunk.started_at)).filter((value): value is number => value !== null);
  const completedValues = chunks.map((chunk) => toMillis(chunk.completed_at)).filter((value): value is number => value !== null);
  const firstStarted = startedValues.length > 0 ? Math.min(...startedValues) : null;
  const lastUpdated = toMillis(job.updated_at);
  const completed = completedValues.length > 0 ? Math.max(...completedValues) : null;
  const status = typeof job.status === "string" ? job.status : "";
  const end = ACTIVE_JOB_STATUSES.has(status)
    ? Math.max(lastUpdated ?? 0, now())
    : completed ?? lastUpdated;
  const elapsedSeconds = firstStarted !== null && end !== null && end >= firstStarted
    ? Math.round((end - firstStarted) / 1000)
    : null;
  const succeededItemsPerMinute = elapsedSeconds && elapsedSeconds > 0
    ? Math.round((succeededItems * 60_000 / (elapsedSeconds * 1000)) * 100) / 100
    : null;

  return {
    created_at: typeof job.created_at === "string" ? job.created_at : null,
    first_started_at: firstStarted === null ? null : new Date(firstStarted).toISOString(),
    completed_at: completed === null ? null : new Date(completed).toISOString(),
    last_updated_at: typeof job.updated_at === "string" ? job.updated_at : null,
    elapsed_seconds: elapsedSeconds,
    succeeded_items_per_minute: succeededItemsPerMinute,
  };
}

function neutralizeSpreadsheetFormula(value: string) {
  return /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export function escapeShoplingPriceBulkCsvCell(value: unknown) {
  const text = neutralizeSpreadsheetFormula(value === null || value === undefined ? "" : String(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function createShoplingPriceBulkItemsCsv(
  jobId: string,
  executionMode: string,
  jobStatus: string,
  items: ShoplingPriceBulkOpsItem[],
) {
  const header = [
    "job_id",
    "execution_mode",
    "job_status",
    "goods_key",
    "ordinal",
    "item_status",
    "attempt_count",
    "last_error",
  ];
  const rows = items.map((item) => [
    jobId,
    executionMode,
    jobStatus,
    item.goods_key,
    item.ordinal,
    item.status,
    item.attempt_count,
    item.last_error ?? "",
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map(escapeShoplingPriceBulkCsvCell).join(",")).join("\r\n")}\r\n`;
}

export function createShoplingPriceBulkSyntheticInput(count = 20_000) {
  if (!Number.isInteger(count) || count < 1 || count > 20_000) throw new Error("synthetic count must be between 1 and 20000");
  return Array.from({ length: count }, (_, index) => String(990_000_000_001 + index)).join("\n");
}

export function runShoplingPriceBulkLocalBenchmark(now: () => number = () => performance.now()) {
  const input = createShoplingPriceBulkSyntheticInput(20_000);
  const started = now();
  const parsed = parseShoplingPriceBulkPaste(input);
  const chunkCount = plannedShoplingPriceBulkChunkCount(parsed.validCount);
  const elapsedMs = Math.max(0, now() - started);
  const estimatedMallRows = parsed.validCount * 24;
  const passed = parsed.validCount === 20_000
    && parsed.duplicateCount === 0
    && parsed.invalidCount === 0
    && chunkCount === 401
    && estimatedMallRows === 480_000;

  return {
    passed,
    elapsed_ms: Math.round(elapsedMs * 100) / 100,
    valid_count: parsed.validCount,
    duplicate_count: parsed.duplicateCount,
    invalid_count: parsed.invalidCount,
    planned_chunk_count: chunkCount,
    estimated_mall_rows: estimatedMallRows,
    generated_at: new Date().toISOString(),
  };
}

export const BULK_CANARY_SIZE = 10;
export const BULK_CHUNK_SIZE = 50;
export type BulkChunkSeed = { chunk_index: number; chunk_type: "canary" | "normal" | "retry"; goods_keys: string[]; status: "pending"; attempt_count: number };

export function createBulkChunks(goodsKeys: string[]): BulkChunkSeed[] {
  if (!goodsKeys.length) throw new Error("유효한 goods_key가 필요합니다.");
  const chunks: BulkChunkSeed[] = [{ chunk_index: 0, chunk_type: "canary", goods_keys: goodsKeys.slice(0, BULK_CANARY_SIZE), status: "pending", attempt_count: 0 }];
  for (let offset = BULK_CANARY_SIZE, index = 1; offset < goodsKeys.length; offset += BULK_CHUNK_SIZE, index++) chunks.push({ chunk_index: index, chunk_type: "normal", goods_keys: goodsKeys.slice(offset, offset + BULK_CHUNK_SIZE), status: "pending", attempt_count: 0 });
  return chunks;
}
export function plannedChunkCount(count: number) { return count ? 1 + Math.ceil(Math.max(0, count - BULK_CANARY_SIZE) / BULK_CHUNK_SIZE) : 0; }
export function extractFailedGoodsKeys(summary: Record<string, unknown>, fallback: string[]) {
  const affected = Array.isArray(summary.affected_goods_keys) ? summary.affected_goods_keys : [];
  const errors = Array.isArray(summary.errors) ? summary.errors.map((item) => item && typeof item === "object" ? (item as Record<string, unknown>).goods_key : undefined) : [];
  const rows = Array.isArray(summary.rows) ? summary.rows.filter((item) => item && typeof item === "object" && (item as Record<string, unknown>).status !== "success").map((item) => (item as Record<string, unknown>).goods_key) : [];
  for (const candidates of [affected, errors, rows]) { const valid = [...new Set(candidates.filter((key): key is string => typeof key === "string" && /^\d+$/.test(key)))]; if (valid.length) return valid; }
  return fallback;
}
export function isSuccessfulSummary(summary: Record<string, unknown>) { return summary.status === "success" && Number(summary.fail_count ?? 0) === 0; }
export function calculateEtaMs(completed: Array<{ dispatched_at?: string | null; completed_at?: string | null }>, remainingChunks: number) { const durations = completed.map((c) => c.dispatched_at && c.completed_at ? Date.parse(c.completed_at) - Date.parse(c.dispatched_at) : 0).filter((v) => v > 0); return durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length * remainingChunks) : null; }

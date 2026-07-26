import "server-only";
import { dispatchShoplingPriceModifyActions, fetchShoplingPriceModifyActionsResult } from "@/lib/shoplingPriceModifyRunner";
import { bulkRpc, bulkUpdate } from "@/lib/shoplingPriceModifyBulkStore";
import { extractFailedGoodsKeys, isSuccessfulSummary } from "@/lib/shoplingPriceModifyBulkJobs";

type Chunk = { id: string; job_id: string; chunk_index: number; chunk_type: "canary" | "normal" | "retry"; goods_keys: string[]; request_id?: string; attempt_count: number; policy_overrides?: unknown };
export type BulkDispatcherAdapters = { dispatch: typeof dispatchShoplingPriceModifyActions; fetchResult: typeof fetchShoplingPriceModifyActionsResult };
const realAdapters: BulkDispatcherAdapters = { dispatch: dispatchShoplingPriceModifyActions, fetchResult: fetchShoplingPriceModifyActionsResult };
function safeError(value: unknown) { return (value instanceof Error ? value.message : String(value)).replace(/(token|secret|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]").slice(0, 500); }

export async function runBulkDispatcher(adapters: BulkDispatcherAdapters = realAdapters) {
  const running = (await bulkRpc("shopling_price_bulk_running_chunks")) as Chunk[] | null;
  for (const chunk of running ?? []) {
    if (!chunk.request_id) continue; const result = await adapters.fetchResult(chunk.request_id); if (result.status === "pending") continue;
    if (result.status === "error" || !result.summary) { await handleFailure(chunk, {}, result.message ?? "결과 확인 실패"); continue; }
    const summary = result.summary as Record<string, unknown>;
    if (isSuccessfulSummary(summary)) await bulkRpc("shopling_price_bulk_complete_chunk", { p_chunk_id: chunk.id, p_summary: summary, p_run_id: result.runId ?? null, p_run_url: result.runUrl ?? null });
    else await handleFailure(chunk, summary, result.message ?? `워크플로 결과: ${String(summary.status ?? "failed")}`);
  }
  const claimed = await bulkRpc("shopling_price_bulk_claim_next") as Chunk[] | Chunk | null; const chunk = Array.isArray(claimed) ? claimed[0] : claimed; if (!chunk) return { processed: (running ?? []).length, dispatched: false };
  try { const result = await adapters.dispatch(chunk.goods_keys.join(","), chunk.policy_overrides); if (result.status !== "queued" || !result.requestId) throw new Error(result.message ?? "dispatch 실패"); await bulkUpdate("shopling_price_bulk_chunks", { status: "running", request_id: result.requestId, dispatched_at: new Date().toISOString() }, chunk.id); return { processed: (running ?? []).length, dispatched: true, chunkId: chunk.id }; }
  catch (error) { await bulkRpc("shopling_price_bulk_release_claim", { p_chunk_id: chunk.id, p_error: safeError(error) }); return { processed: (running ?? []).length, dispatched: false, error: safeError(error) }; }
}
async function handleFailure(chunk: Chunk, summary: Record<string, unknown>, message: string) { const failed = extractFailedGoodsKeys(summary, chunk.goods_keys); await bulkRpc("shopling_price_bulk_fail_chunk", { p_chunk_id: chunk.id, p_failed_goods_keys: failed, p_summary: summary, p_error: safeError(message) }); }

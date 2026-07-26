import { NextResponse } from "next/server";
import { bulkRpc } from "@/lib/shoplingPriceModifyBulkDb";
import { failedKeysFromSummary } from "@/lib/shoplingPriceModifyBulk";
import { dispatchReservedShoplingPriceModifyActions, fetchShoplingPriceModifyActionsResult, generateShoplingPriceModifyRequestId } from "@/lib/shoplingPriceModifyRunner";
export const runtime = "nodejs";
function authorized(request: Request) { const secret = process.env.SHOPLING_PRICE_BULK_CRON_SECRET; return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`; }
type Chunk = { id: string; request_id?: string; goods_keys: string[]; policy_overrides?: unknown; kind: string };
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  try {
    const active = await bulkRpc("shopling_price_bulk_active_chunk") as Chunk | null;
    if (active) {
      if (!active.request_id) { await bulkRpc("shopling_price_bulk_block", { p_chunk_id: active.id, p_error: "dispatching 청크의 request_id가 없습니다." }); return NextResponse.json({ status: "blocked" }); }
      const result = await fetchShoplingPriceModifyActionsResult(active.request_id);
      if (result.status === "error") return NextResponse.json({ status: "deferred", message: "결과 조회를 다음 scheduler에서 재시도합니다." });
      if (result.status === "pending") return NextResponse.json({ status: "pending", request_id: active.request_id });
      if (result.requestId !== active.request_id || !result.summary) return NextResponse.json({ status: "ignored", message: "exact request_id 결과가 아닙니다." });
      const summary = result.summary as Record<string, unknown>; const failCount = Number(summary.fail_count ?? 0);
      const failedKeys = failedKeysFromSummary(summary, active.goods_keys);
      if (active.kind === "canary" && (summary.status !== "success" || failCount !== 0) && failCount === 0) { await bulkRpc("shopling_price_bulk_block", { p_chunk_id: active.id, p_error: "카나리 terminal summary가 성공 계약을 충족하지 않습니다." }); return NextResponse.json({ status: "blocked" }); }
      if (failCount > 0 && !failedKeys.length) { await bulkRpc("shopling_price_bulk_block", { p_chunk_id: active.id, p_error: "실패 goods_key를 특정할 수 없어 안전하게 중단했습니다." }); return NextResponse.json({ status: "blocked" }); }
      await bulkRpc("shopling_price_bulk_finish_chunk", { p_chunk_id: active.id, p_request_id: active.request_id, p_failed_keys: failedKeys, p_summary: summary, p_run_url: result.runUrl ?? null });
    }
    const requestId = generateShoplingPriceModifyRequestId();
    const claimed = await bulkRpc("shopling_price_bulk_claim", { p_request_id: requestId }) as Chunk | null;
    if (!claimed) return NextResponse.json({ status: "idle" });
    const dispatched = await dispatchReservedShoplingPriceModifyActions(claimed.goods_keys, claimed.policy_overrides ?? [], requestId);
    if (dispatched.status === "queued") { await bulkRpc("shopling_price_bulk_mark_running", { p_chunk_id: claimed.id, p_request_id: requestId, p_actions_url: dispatched.githubActionsUrl ?? null }); return NextResponse.json({ status: "dispatched", request_id: requestId }); }
    await bulkRpc("shopling_price_bulk_block", { p_chunk_id: claimed.id, p_error: dispatched.message ?? "dispatch 결과 불명확" });
    return NextResponse.json({ status: "blocked" });
  } catch (error) { return NextResponse.json({ status: "error", message: error instanceof Error ? error.message : "scheduler error" }, { status: 500 }); }
}

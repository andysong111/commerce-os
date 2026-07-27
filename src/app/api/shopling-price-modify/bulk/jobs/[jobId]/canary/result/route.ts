import { NextResponse } from "next/server";
import { analyzeShoplingPriceBulkCanaryResult } from "@/lib/shoplingPriceModifyBulkCanary";
import { normalError, normalSession, requireManualShoplingPriceBulkJob } from "@/lib/shoplingPriceModifyBulkApi";
import { fetchShoplingPriceModifyActionsResult } from "@/lib/shoplingPriceModifyRunner";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const auth = await normalSession();
  if (auth.response) return auth.response;
  const { jobId } = await params;

  const manual = await requireManualShoplingPriceBulkJob(auth.admin!, jobId, auth.ownerId, "canary.result");
  if (manual.response) return manual.response;
  if (!new Set(["canary_running", "dispatch_uncertain"]).has(String(manual.job.status))) {
    return normalError("현재 상태에서는 카나리 결과를 확인할 수 없습니다.", 409, "INVALID_JOB_STATUS", "canary.result.job_query");
  }

  const chunkResult = await auth.admin!.from("shopling_price_bulk_chunks")
    .select("request_id,goods_keys,status")
    .eq("job_id", jobId)
    .eq("chunk_index", 0)
    .maybeSingle();
  if (chunkResult.error) return normalError("카나리 청크 조회에 실패했습니다.", 500, "CHUNK_QUERY_FAILED", "canary.result.chunk_query", chunkResult.error);
  if (!chunkResult.data) return normalError("카나리 청크를 찾을 수 없습니다.", 404, "CHUNK_NOT_FOUND", "canary.result.chunk_query");

  const chunk = chunkResult.data as Record<string, unknown>;
  const requestId = typeof chunk.request_id === "string" ? chunk.request_id : "";
  const goodsKeys = Array.isArray(chunk.goods_keys)
    ? chunk.goods_keys.filter((value): value is string => typeof value === "string")
    : [];
  if (!requestId || goodsKeys.length === 0) {
    return normalError("카나리 요청 정보가 불완전합니다.", 409, "CHUNK_CONTEXT_INVALID", "canary.result.chunk_query");
  }

  const actionsResult = await fetchShoplingPriceModifyActionsResult(requestId);
  if (actionsResult.status === "pending") {
    return NextResponse.json({
      status: "pending",
      request_id: requestId,
      message: "카나리 결과가 아직 준비되지 않았습니다. 잠시 후 다시 확인하세요.",
    });
  }
  if (actionsResult.status === "error" || !actionsResult.summary) {
    return normalError(actionsResult.message ?? "카나리 결과를 가져오지 못했습니다.", 502, "ACTIONS_RESULT_FAILED", "canary.result.actions_result");
  }

  const analysis = analyzeShoplingPriceBulkCanaryResult(
    actionsResult.summary,
    requestId,
    goodsKeys,
    actionsResult.runConclusion,
  );
  const finished = await auth.admin!.rpc("finish_shopling_price_bulk_canary", {
    p_job_id: jobId,
    p_owner_id: auth.ownerId,
    p_request_id: requestId,
    p_success: analysis.success,
    p_failure_scope_known: analysis.failureScopeKnown,
    p_failed_keys: analysis.failedKeys,
    p_summary: actionsResult.summary,
    p_run_url: actionsResult.runUrl ?? null,
    p_error: analysis.success ? null : analysis.message,
  });
  if (finished.error) return normalError("카나리 결과 저장에 실패했습니다.", 500, "FINISH_FAILED", "canary.result.finish", finished.error);

  return NextResponse.json({
    status: analysis.success ? "canary_succeeded" : "canary_failed",
    request_id: requestId,
    run_url: actionsResult.runUrl,
    failed_keys: analysis.failedKeys,
    failure_scope_known: analysis.failureScopeKnown,
    message: analysis.message,
  });
}

import { analyzeShoplingPriceBulkCanaryResult } from "@/lib/shoplingPriceModifyBulkCanary";
import { buildShoplingPriceModifyDispatchRequest, isValidShoplingPriceModifyRequestId, type ShoplingPriceModifySummary } from "@/lib/shoplingPriceModifyRunner";

export type NormalDispatchResult = { status: "queued" | "rejected" | "uncertain"; requestId: string; message: string; githubActionsUrl?: string };

export async function dispatchShoplingPriceBulkNormal(goodsKeys: readonly string[], policyOverrides: unknown, requestId: string): Promise<NormalDispatchResult> {
  if (process.env.SHOPLING_PRICE_MODIFY_ENABLED !== "1") return { status: "rejected", requestId, message: "SHOPLING_PRICE_MODIFY_ENABLED=1 설정이 필요합니다." };
  if (!isValidShoplingPriceModifyRequestId(requestId)) return { status: "rejected", requestId, message: "요청 추적 ID 형식이 올바르지 않습니다." };
  if (goodsKeys.length < 1 || goodsKeys.length > 50 || goodsKeys.some((key) => !/^\d+$/.test(key))) return { status: "rejected", requestId, message: "일반 청크는 숫자 goods_key 1~50개만 실행할 수 있습니다." };
  if (new Set(goodsKeys).size !== goodsKeys.length) return { status: "rejected", requestId, message: "일반 청크 goods_key에 중복이 있습니다." };
  let dispatch;
  try { dispatch = buildShoplingPriceModifyDispatchRequest(goodsKeys.join(","), policyOverrides); }
  catch (error) { return { status: "rejected", requestId, message: error instanceof Error ? error.message : "실행 요청을 만들 수 없습니다." }; }
  dispatch.requestId = requestId;
  dispatch.body.inputs.request_id = requestId;
  try {
    const response = await fetch(dispatch.url, { method: "POST", headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${dispatch.token}`, "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" }, body: JSON.stringify(dispatch.body) });
    if (response.status === 200 || response.status === 204) return { status: "queued", requestId, message: "일반 청크 실행 요청이 전송되었습니다.", githubActionsUrl: dispatch.githubActionsUrl };
    return { status: response.status >= 400 && response.status < 500 ? "rejected" : "uncertain", requestId, message: `GitHub Actions 요청 실패 status=${response.status}`, githubActionsUrl: dispatch.githubActionsUrl };
  } catch (error) { return { status: "uncertain", requestId, message: error instanceof Error ? error.message : "GitHub 응답을 확인하지 못했습니다.", githubActionsUrl: dispatch.githubActionsUrl }; }
}

export function analyzeShoplingPriceBulkNormalResult(summary: ShoplingPriceModifySummary, requestId: string, goodsKeys: readonly string[], conclusion: string | null | undefined) {
  return analyzeShoplingPriceBulkCanaryResult(summary, requestId, goodsKeys, conclusion);
}

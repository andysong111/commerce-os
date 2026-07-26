import {
  buildShoplingPriceModifyDispatchRequest,
  isValidShoplingPriceModifyRequestId,
  type ShoplingPriceModifySummary,
} from "@/lib/shoplingPriceModifyRunner";

const GOODS_KEY_PATTERN = /^\d+$/;

export type ShoplingPriceBulkCanaryDispatchResult =
  | { status: "queued"; requestId: string; githubActionsUrl: string }
  | { status: "rejected" | "uncertain"; requestId: string; message: string; githubActionsUrl?: string };

export type ShoplingPriceBulkCanaryAnalysis = {
  success: boolean;
  failedKeys: string[];
  failureScopeKnown: boolean;
  message: string;
};

export async function dispatchShoplingPriceBulkCanary(
  goodsKeys: readonly string[],
  policyOverrides: unknown,
  requestId: string,
): Promise<ShoplingPriceBulkCanaryDispatchResult> {
  if (process.env.SHOPLING_PRICE_MODIFY_ENABLED !== "1") {
    return { status: "rejected", requestId, message: "SHOPLING_PRICE_MODIFY_ENABLED=1 설정이 필요합니다." };
  }
  if (!isValidShoplingPriceModifyRequestId(requestId)) {
    return { status: "rejected", requestId, message: "요청 추적 ID 형식이 올바르지 않습니다." };
  }
  if (goodsKeys.length < 1 || goodsKeys.length > 10 || goodsKeys.some((key) => !GOODS_KEY_PATTERN.test(key))) {
    return { status: "rejected", requestId, message: "카나리는 숫자 goods_key 1~10개만 실행할 수 있습니다." };
  }
  if (new Set(goodsKeys).size !== goodsKeys.length) {
    return { status: "rejected", requestId, message: "카나리 goods_key에 중복이 있습니다." };
  }

  let request;
  try {
    request = buildShoplingPriceModifyDispatchRequest(goodsKeys.join(","), policyOverrides);
  } catch (error) {
    return { status: "rejected", requestId, message: error instanceof Error ? error.message : "카나리 실행 요청을 만들 수 없습니다." };
  }

  request.requestId = requestId;
  request.body.inputs.request_id = requestId;

  try {
    const response = await fetch(request.url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${request.token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(request.body),
    });
    if (response.status === 200 || response.status === 204) {
      return { status: "queued", requestId, githubActionsUrl: request.githubActionsUrl };
    }
    const message = `GitHub Actions 카나리 실행 요청에 실패했습니다. status=${response.status}`;
    return {
      status: response.status >= 400 && response.status < 500 ? "rejected" : "uncertain",
      requestId,
      message,
      githubActionsUrl: request.githubActionsUrl,
    };
  } catch (error) {
    return {
      status: "uncertain",
      requestId,
      message: error instanceof Error ? error.message : "GitHub Actions 응답을 확인하지 못했습니다.",
      githubActionsUrl: request.githubActionsUrl,
    };
  }
}

export function analyzeShoplingPriceBulkCanaryResult(
  summary: ShoplingPriceModifySummary,
  expectedRequestId: string,
  expectedGoodsKeys: readonly string[],
  runConclusion: string | null | undefined,
): ShoplingPriceBulkCanaryAnalysis {
  const requestId = typeof summary.request_id === "string" ? summary.request_id : "";
  if (requestId !== expectedRequestId) {
    return { success: false, failedKeys: [], failureScopeKnown: false, message: "카나리 결과의 request_id가 일치하지 않습니다." };
  }

  const expectedSet = new Set(expectedGoodsKeys);
  const summaryGoodsKeys = Array.isArray(summary.goods_keys)
    ? summary.goods_keys.filter((value): value is string => typeof value === "string")
    : [];
  if (summaryGoodsKeys.length > 0 && (summaryGoodsKeys.length !== expectedSet.size || summaryGoodsKeys.some((key) => !expectedSet.has(key)))) {
    return { success: false, failedKeys: [], failureScopeKnown: false, message: "카나리 결과의 goods_key 범위가 요청과 일치하지 않습니다." };
  }

  const failCount = Number(summary.fail_count);
  const status = typeof summary.status === "string" ? summary.status : "";
  if (runConclusion === "success" && status === "success" && Number.isInteger(failCount) && failCount === 0) {
    return { success: true, failedKeys: [], failureScopeKnown: true, message: "카나리 가격설정이 성공했습니다." };
  }

  const failedKeys = extractExplicitFailedGoodsKeys(summary, expectedSet);
  const failureScopeKnown = failedKeys.length > 0;
  const reason = runConclusion && runConclusion !== "success"
    ? `GitHub Actions conclusion=${runConclusion}`
    : status && status !== "success"
      ? `result status=${status}`
      : Number.isFinite(failCount)
        ? `fail_count=${failCount}`
        : "결과 요약 형식이 불완전합니다.";

  return {
    success: false,
    failedKeys,
    failureScopeKnown,
    message: failureScopeKnown
      ? `카나리 실패 상품 ${failedKeys.length}개를 확인했습니다. ${reason}`
      : `카나리 실행은 성공 계약을 충족하지 못했고 실패 goods_key를 특정할 수 없습니다. ${reason}`,
  };
}

function extractExplicitFailedGoodsKeys(summary: ShoplingPriceModifySummary, expectedSet: Set<string>): string[] {
  const record = summary as Record<string, unknown>;
  const candidates = [record.errors, record.rows];
  const keys: string[] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const row of candidate) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      if (candidate === record.rows && item.status === "success") continue;
      const key = typeof item.goods_key === "string" ? item.goods_key : "";
      if (expectedSet.has(key)) keys.push(key);
    }
  }
  return [...new Set(keys)];
}

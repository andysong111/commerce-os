import { analyzeShoplingPriceBulkNormalResult, dispatchShoplingPriceBulkNormal } from "@/lib/shoplingPriceModifyBulkNormal";

export const analyzeShoplingPriceBulkRetryResult = analyzeShoplingPriceBulkNormalResult;

export async function dispatchShoplingPriceBulkRetry(
  goodsKeys: readonly string[],
  policyOverrides: unknown,
  requestId: string,
  signal?: AbortSignal,
) {
  return dispatchShoplingPriceBulkNormal(goodsKeys, policyOverrides, requestId, signal);
}

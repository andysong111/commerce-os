export type ShoplingPriceBulkChunkSeed = {
  chunkIndex: number;
  chunkType: "canary" | "normal";
  goodsKeys: string[];
  goodsKeyCount: number;
  status: "pending";
  attemptCount: 0;
};

export function createShoplingPriceBulkPreparedChunks(goodsKeys: readonly string[]): ShoplingPriceBulkChunkSeed[] {
  if (goodsKeys.length === 0) return [];
  const chunks: ShoplingPriceBulkChunkSeed[] = [];
  const add = (chunkType: "canary" | "normal", values: string[]) => chunks.push({
    chunkIndex: chunks.length, chunkType, goodsKeys: values, goodsKeyCount: values.length, status: "pending", attemptCount: 0,
  });
  add("canary", goodsKeys.slice(0, 10));
  for (let start = 10; start < goodsKeys.length; start += 50) add("normal", goodsKeys.slice(start, start + 50));
  return chunks;
}

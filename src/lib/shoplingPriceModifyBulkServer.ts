import { SHOPLING_PRICE_BULK_MAX_GOODS_KEYS, type ShoplingPriceBulkInputResult } from "@/lib/shoplingPriceModifyBulkInput";

export type ShoplingPriceBulkCreateInput = Pick<ShoplingPriceBulkInputResult, "goodsKeys" | "originalCount" | "duplicateCount" | "invalidCount"> & {
  inputSource: ShoplingPriceBulkInputResult["source"];
};

export function validateShoplingPriceBulkCreateInput(value: unknown): ShoplingPriceBulkCreateInput {
  if (!value || typeof value !== "object") throw new Error("입력 통계가 일치하지 않습니다.");
  const body = value as Record<string, unknown>;
  const goodsKeys = body.goods_keys;
  if (!Array.isArray(goodsKeys) || goodsKeys.length === 0) throw new Error("유효한 goods_key가 없습니다.");
  if (goodsKeys.length > SHOPLING_PRICE_BULK_MAX_GOODS_KEYS) throw new Error("goods_key는 최대 20,000개까지 저장할 수 있습니다.");
  if (!goodsKeys.every((key) => typeof key === "string" && /^\d+$/.test(key))) throw new Error("goods_key는 숫자로만 구성되어야 합니다.");
  if (new Set(goodsKeys).size !== goodsKeys.length) throw new Error("중복 goods_key가 서버 요청에 포함되어 있습니다.");
  if (!(["paste", "csv", "xlsx"] as unknown[]).includes(body.input_source)) throw new Error("입력 방식이 올바르지 않습니다.");
  const statistics = [body.original_count, body.duplicate_count, body.invalid_count];
  if (!statistics.every((count) => Number.isInteger(count) && Number(count) >= 0)) throw new Error("입력 통계가 일치하지 않습니다.");
  if (body.original_count !== goodsKeys.length + Number(body.duplicate_count) + Number(body.invalid_count)) throw new Error("입력 통계가 일치하지 않습니다.");
  return { inputSource: body.input_source as ShoplingPriceBulkInputResult["source"], goodsKeys, originalCount: Number(body.original_count), duplicateCount: Number(body.duplicate_count), invalidCount: Number(body.invalid_count) };
}

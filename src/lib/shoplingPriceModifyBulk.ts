import type { ShoplingPriceModifyPolicyOverride } from "./shoplingPriceModifyRunner";

export const SHOPLING_PRICE_BULK_MAX_ITEMS = 20_000;
export const SHOPLING_PRICE_BULK_CANARY_SIZE = 10;
export const SHOPLING_PRICE_BULK_CHUNK_SIZE = 50;

export type BulkItemStatus = "pending" | "running" | "retry_waiting" | "succeeded" | "final_failed";
export type BulkChunk = { kind: "canary" | "normal" | "retry"; sequence: number; goodsKeys: string[]; attempt: number };

export function parseShoplingPriceBulkInput(input: string) {
  const raw = input.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean);
  const goodsKeys: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  for (const value of raw) {
    if (!/^\d+$/.test(value)) { invalid.push(value); continue; }
    if (seen.has(value)) { duplicateCount += 1; continue; }
    seen.add(value); goodsKeys.push(value);
  }
  if (goodsKeys.length > SHOPLING_PRICE_BULK_MAX_ITEMS) throw new Error(`유효 goods_key는 최대 ${SHOPLING_PRICE_BULK_MAX_ITEMS.toLocaleString()}개입니다.`);
  return { originalCount: raw.length, goodsKeys, validCount: goodsKeys.length, duplicateCount, invalid, invalidCount: invalid.length };
}

export function splitShoplingPriceBulkChunks(goodsKeys: string[]): BulkChunk[] {
  if (goodsKeys.length === 0) return [];
  if (goodsKeys.length > SHOPLING_PRICE_BULK_MAX_ITEMS) throw new Error("goods_key limit exceeded");
  const chunks: BulkChunk[] = [{ kind: "canary", sequence: 0, goodsKeys: goodsKeys.slice(0, SHOPLING_PRICE_BULK_CANARY_SIZE), attempt: 0 }];
  for (let offset = SHOPLING_PRICE_BULK_CANARY_SIZE, sequence = 1; offset < goodsKeys.length; offset += SHOPLING_PRICE_BULK_CHUNK_SIZE, sequence += 1) {
    chunks.push({ kind: "normal", sequence, goodsKeys: goodsKeys.slice(offset, offset + SHOPLING_PRICE_BULK_CHUNK_SIZE), attempt: 0 });
  }
  return chunks;
}

export function failedGoodsKeys(summary: { errors?: unknown; fail_count?: unknown }, requested: string[]) {
  const requestedSet = new Set(requested);
  const failures = new Set<string>();
  if (Array.isArray(summary.errors)) for (const error of summary.errors) {
    const key = error && typeof error === "object" && "goods_key" in error ? String(error.goods_key) : "";
    if (requestedSet.has(key)) failures.add(key);
  }
  if (Number(summary.fail_count) > 0 && failures.size === 0) throw new Error("실패 goods_key를 summary에서 확인할 수 없습니다.");
  return requested.filter((key) => failures.has(key));
}

export function isSuccessfulCanary(summary: Record<string, unknown>, requestId: string) {
  return summary.request_id === requestId && summary.status === "success" && Number(summary.fail_count) === 0;
}

export function bulkProgress(items: Array<{ status: BulkItemStatus; attempt?: number }>) {
  const succeeded = items.filter((item) => item.status === "succeeded").length;
  const finalFailed = items.filter((item) => item.status === "final_failed").length;
  return { succeeded, finalFailed, retryWaiting: items.filter((item) => item.status === "retry_waiting").length, retrySucceeded: items.filter((item) => item.status === "succeeded" && Number(item.attempt) > 0).length, completed: succeeded + finalFailed, total: items.length, ratio: items.length ? (succeeded + finalFailed) / items.length : 0 };
}

export function validateBulkCreateInput(input: unknown) {
  if (!input || typeof input !== "object") throw new Error("요청 형식이 올바르지 않습니다.");
  const value = input as { goods_keys?: unknown; policy_overrides?: unknown };
  if (!Array.isArray(value.goods_keys)) throw new Error("goods_keys 배열이 필요합니다.");
  const parsed = parseShoplingPriceBulkInput(value.goods_keys.map(String).join("\n"));
  if (!parsed.validCount || parsed.invalidCount) throw new Error("goods_keys는 숫자로만 구성되어야 합니다.");
  return { goodsKeys: parsed.goodsKeys, policyOverrides: (value.policy_overrides ?? []) as ShoplingPriceModifyPolicyOverride[] };
}

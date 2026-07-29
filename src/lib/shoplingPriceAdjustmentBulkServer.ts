export type ShoplingPriceAdjustmentBulkCreateInput = {
  inputSource: "paste" | "csv" | "xlsx";
  rows: Array<{ goodsKey: string; adjustmentBps: number }>;
  originalCount: number;
  duplicateCount: number;
  invalidCount: number;
};

const MAX_ROWS = 10_000;

export function validateShoplingPriceAdjustmentBulkCreateInput(value: unknown): ShoplingPriceAdjustmentBulkCreateInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Bulk 입력이 올바르지 않습니다.");
  const record = value as Record<string, unknown>;
  const allowed = ["inputSource", "rows", "originalCount", "duplicateCount", "invalidCount"];
  if (Object.keys(record).some((key) => !allowed.includes(key))) throw new Error("Bulk 입력에 허용되지 않은 필드가 있습니다.");
  const inputSource = record.inputSource;
  if (inputSource !== "paste" && inputSource !== "csv" && inputSource !== "xlsx") throw new Error("입력 형식이 올바르지 않습니다.");
  if (!Array.isArray(record.rows) || record.rows.length === 0 || record.rows.length > MAX_ROWS) {
    throw new Error(`유효 상품은 1~${MAX_ROWS.toLocaleString("ko-KR")}개까지 사용할 수 있습니다.`);
  }
  const originalCount = record.originalCount;
  const duplicateCount = record.duplicateCount;
  const invalidCount = record.invalidCount;
  if (typeof originalCount !== "number" || !Number.isSafeInteger(originalCount) || originalCount < 0) throw new Error("원본 행 통계가 올바르지 않습니다.");
  if (typeof duplicateCount !== "number" || !Number.isSafeInteger(duplicateCount) || duplicateCount < 0) throw new Error("중복 통계가 올바르지 않습니다.");
  if (typeof invalidCount !== "number" || !Number.isSafeInteger(invalidCount) || invalidCount < 0) throw new Error("잘못된 행 통계가 올바르지 않습니다.");
  if (originalCount !== record.rows.length + duplicateCount + invalidCount) throw new Error("입력 통계가 일치하지 않습니다.");

  const seen = new Set<string>();
  const rows = record.rows.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${index + 1}번째 행이 올바르지 않습니다.`);
    const row = entry as Record<string, unknown>;
    if (Object.keys(row).length !== 2 || Object.keys(row).some((key) => !["goodsKey", "adjustmentBps"].includes(key))) {
      throw new Error(`${index + 1}번째 행 필드가 올바르지 않습니다.`);
    }
    const goodsKey = row.goodsKey;
    const adjustmentBps = row.adjustmentBps;
    if (typeof goodsKey !== "string" || !/^\d+$/.test(goodsKey)) throw new Error(`${index + 1}번째 goods_key가 올바르지 않습니다.`);
    if (seen.has(goodsKey)) throw new Error(`중복 goods_key가 있습니다: ${goodsKey}`);
    if (typeof adjustmentBps !== "number" || !Number.isInteger(adjustmentBps) || adjustmentBps < -9_999 || adjustmentBps > 100_000) {
      throw new Error(`${index + 1}번째 조정률이 허용 범위를 벗어났습니다.`);
    }
    seen.add(goodsKey);
    return { goodsKey, adjustmentBps };
  });

  return { inputSource, rows, originalCount, duplicateCount, invalidCount };
}

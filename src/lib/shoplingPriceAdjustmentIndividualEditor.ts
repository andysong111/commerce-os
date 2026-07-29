export type ShoplingIndividualDraftRow = {
  goodsKey: string;
  rateText: string;
};

export type ShoplingIndividualDraftParseResult = {
  rows: ShoplingIndividualDraftRow[];
  duplicateCount: number;
  invalid: string[];
};

const GOODS_KEY_PATTERN = /^\d+$/;

export function parseShoplingIndividualDraft(input: string): ShoplingIndividualDraftParseResult {
  const rows: ShoplingIndividualDraftRow[] = [];
  const seen = new Set<string>();
  const invalid: string[] = [];
  let duplicateCount = 0;

  for (const rawLine of input.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const values = line.includes("\t") || line.includes(",")
      ? line.split(/[\t,]/).map((value) => value.trim()).filter(Boolean)
      : line.split(/\s+/).filter(Boolean);
    if (values[0]?.toLowerCase() === "goods_key") continue;
    if (values.length < 1 || values.length > 2) {
      invalid.push(`${line}: goods_key와 선택 조정률만 입력할 수 있습니다.`);
      continue;
    }
    const [goodsKey, rateText = ""] = values;
    if (!GOODS_KEY_PATTERN.test(goodsKey)) {
      invalid.push(`${line}: goods_key는 숫자만 사용할 수 있습니다.`);
      continue;
    }
    if (seen.has(goodsKey)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(goodsKey);
    rows.push({ goodsKey, rateText });
  }

  if (rows.length > 20_000) throw new Error("상품은 최대 20,000개까지 편집할 수 있습니다.");
  return { rows, duplicateCount, invalid };
}

export function serializeShoplingIndividualDraft(rows: ShoplingIndividualDraftRow[]) {
  return rows.map((row) => `${row.goodsKey}\t${row.rateText.trim()}`).join("\n");
}

export function applyShoplingIndividualBulkRate(
  rows: ShoplingIndividualDraftRow[],
  selectedGoodsKeys: ReadonlySet<string>,
  rateText: string,
  applyToAll = false,
) {
  const normalized = rateText.trim();
  return rows.map((row) => applyToAll || selectedGoodsKeys.has(row.goodsKey)
    ? { ...row, rateText: normalized }
    : row);
}

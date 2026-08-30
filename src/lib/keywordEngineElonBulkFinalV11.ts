import { compactKeywordElonKey } from "./keywordEngineElonLabV2.ts";
import { generateSafeBulkKeywordSupplements } from "./keywordEngineElonBulkKeywordRecovery.ts";
import {
  composeKeywordElonBulkFinal as composeKeywordElonBulkFinalBase,
  type KeywordElonBulkComposeInput,
  type KeywordElonBulkFinalResult,
} from "./keywordEngineElonBulkFinal.ts";

export {
  SEO_TITLE_EXPANSION_META_GROUP_KEY,
  collectKeywordElonBulkSource,
  generateKeywordElonBulkFinal,
} from "./keywordEngineElonBulkFinal.ts";
export type {
  KeywordElonBulkComposeInput,
  KeywordElonBulkFinalInput,
  KeywordElonBulkFinalResult,
} from "./keywordEngineElonBulkFinal.ts";

function uniqueSupplements(values: unknown[], limit = 30) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = compactKeywordElonKey(value);
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= limit) break;
  }
  return out;
}

function recoverableSparseComposeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return [
    "FINAL 검색어가 10개가 아닙니다",
    "상품명용 우수 키워드가 부족합니다",
    "검증 키워드만으로",
    "고유 쇼핑몰별 상품명",
    "카테고리 정합 상품명 후보가 부족합니다",
    "쇼핑몰별 상품명에 중복이 발생했습니다",
  ].some((token) => message.includes(token));
}

export async function composeKeywordElonBulkFinal(
  input: KeywordElonBulkComposeInput,
): Promise<KeywordElonBulkFinalResult> {
  try {
    return composeKeywordElonBulkFinalBase(input);
  } catch (error) {
    if (!recoverableSparseComposeError(error)) throw error;

    // V11 never lowers the normal search/relevance threshold just to fill a sparse
    // portfolio. Recovery material is generated from the verified product identity,
    // then passed through the SAME guarded STEP4 path (built-in risk terms, custom
    // blocks and V10 semantic consistency) before it can enter FINAL/title compose.
    const safeSupplements = await generateSafeBulkKeywordSupplements({
      identity: input.identity,
      source: input.source,
      productName: input.productName,
      customBlockedTerms: input.customBlockedTerms ?? [],
    });
    const supplementalSearchKeywords = uniqueSupplements([
      ...(input.supplementalSearchKeywords ?? []),
      ...safeSupplements,
    ]);
    if (!supplementalSearchKeywords.length) throw error;

    return composeKeywordElonBulkFinalBase({
      ...input,
      supplementalSearchKeywords,
    });
  }
}

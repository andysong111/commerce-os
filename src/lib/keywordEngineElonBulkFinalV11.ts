import { compactKeywordElonKey } from "./keywordEngineElonLabV2.ts";
import { generateSafeBulkKeywordSupplements } from "./keywordEngineElonBulkKeywordRecovery.ts";
import {
  SEO_TITLE_EXPANSION_META_GROUP_KEY,
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

function uniqueSupplements(values: unknown[], limit = 120) {
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

function verifiedDirectPool(input: KeywordElonBulkComposeInput) {
  const allowed = new Set(input.allowedKeys.map(compactKeywordElonKey).filter(Boolean));
  return uniqueSupplements(
    input.candidates
      .filter((row) => row.safetyPass)
      .map((row) => row.searchKeyword || row.searchKey || row.keyword)
      .filter((keyword) => allowed.has(compactKeywordElonKey(keyword))),
    120,
  );
}

function finalizeKeywordPools(
  result: KeywordElonBulkFinalResult,
  input: KeywordElonBulkComposeInput,
) {
  const directPool = verifiedDirectPool(input);
  const recoveryPool = uniqueSupplements(input.supplementalSearchKeywords ?? [], 120);
  const rawMeta = result.seoFinal.groupProductNames[SEO_TITLE_EXPANSION_META_GROUP_KEY];
  let parsedMeta: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(rawMeta ?? "{}")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      parsedMeta = parsed as Record<string, unknown>;
    }
  } catch {
    parsedMeta = {};
  }

  const verifiedKeywordPool = uniqueSupplements(
    [...directPool, ...recoveryPool],
    120,
  );
  const groupProductNames = {
    ...result.seoFinal.groupProductNames,
    [SEO_TITLE_EXPANSION_META_GROUP_KEY]: JSON.stringify({
      ...parsedMeta,
      verifiedDirectKeywordPool: directPool,
      verifiedRecoveryKeywordPool: recoveryPool,
      verifiedKeywordPool,
      shoplingSearchKeywords: result.seoFinal.searchKeywords,
    }),
  };
  const seoFinal = {
    ...result.seoFinal,
    groupProductNames,
    // Runtime persistence for future UI/analysis. Shopling continues to consume only
    // `searchKeywords` (ten external slots); the larger verified pool is not discarded.
    verifiedKeywordPool,
  } as typeof result.seoFinal & { verifiedKeywordPool: string[] };

  return {
    ...result,
    seoFinal,
    warnings: [
      ...result.warnings,
      `SEO_KEYWORD_V12_VERIFIED_DIRECT_POOL:${directPool.length}`,
      `SEO_KEYWORD_V12_VERIFIED_RECOVERY_POOL:${recoveryPool.length}`,
      `SEO_KEYWORD_V12_VERIFIED_POOL:${verifiedKeywordPool.length}`,
      "SEO_KEYWORD_V12_SHOPLING_OUTPUT_LIMIT:10",
    ],
  } as KeywordElonBulkFinalResult;
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
    return finalizeKeywordPools(composeKeywordElonBulkFinalBase(input), input);
  } catch (error) {
    if (!recoverableSparseComposeError(error)) throw error;

    // V12 never lowers the normal search/relevance threshold just to fill a sparse
    // portfolio. Recovery material is generated from verified product facts, screened
    // for natural marketplace-search form, then passed through the SAME guarded STEP4
    // path (built-in risk terms, custom blocks and V10 semantic consistency).
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

    const recoveredInput: KeywordElonBulkComposeInput = {
      ...input,
      supplementalSearchKeywords,
    };
    return finalizeKeywordPools(
      composeKeywordElonBulkFinalBase(recoveredInput),
      recoveredInput,
    );
  }
}

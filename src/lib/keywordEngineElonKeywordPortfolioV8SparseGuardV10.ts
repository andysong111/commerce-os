import {
  buildKeywordElonTitleKeywordReservoirV8 as buildKeywordElonTitleKeywordReservoirV8Base,
  rankKeywordElonDirectKeywordsV8,
  type KeywordElonComplementSearchSelectionV8,
  type KeywordElonRankedDirectKeywordV8,
  type KeywordElonTitleKeywordReservoirV8,
} from "./keywordEngineElonKeywordPortfolioV8.ts";
import type { KeywordElonCandidate } from "./keywordEngineElonLabV2.ts";
import { compactKeywordElonKey } from "./keywordEngineElonLabV2.ts";
import { keywordElonSeoUtf8Bytes } from "./keywordEngineElonLabSeoOutput.ts";

export { rankKeywordElonDirectKeywordsV8 };
export type {
  KeywordElonComplementSearchSelectionV8,
  KeywordElonRankedDirectKeywordV8,
  KeywordElonTitleKeywordReservoirV8,
};

const TITLE_RESERVOIR_CAPACITY_V11 = 29;
const SAME_MALL_MIN_TITLE_MATERIALS_V11 = 4;
const SEARCH_TERM_BYTE_LIMIT = 30;
const SEARCH_KEYWORD_LIMIT = 10;

function sparseEligible(rows: KeywordElonRankedDirectKeywordV8[]) {
  return rows.filter(
    (row) =>
      row.titleEligible &&
      row.relevance >= 80 &&
      row.shoppingIntent >= 70,
  );
}

function blockedTerms(input: {
  blockedKeys?: string[];
  customBlockedTerms?: string[];
}) {
  return [...(input.blockedKeys ?? []), ...(input.customBlockedTerms ?? [])]
    .map(compactKeywordElonKey)
    .filter((value) => value.length >= 2);
}

function appendGroundedFallbacks(input: {
  titleKeywords: string[];
  fallbackKeywords?: string[];
  blockedKeys?: string[];
  customBlockedTerms?: string[];
}) {
  const titleKeywords = [...input.titleKeywords];
  const seen = new Set(titleKeywords.map(compactKeywordElonKey).filter(Boolean));
  const blocked = blockedTerms(input);
  let added = 0;

  for (const raw of input.fallbackKeywords ?? []) {
    if (titleKeywords.length >= SAME_MALL_MIN_TITLE_MATERIALS_V11) break;
    const keyword = compactKeywordElonKey(raw);
    if (
      keyword.length < 2 ||
      seen.has(keyword) ||
      keywordElonSeoUtf8Bytes(keyword) > SEARCH_TERM_BYTE_LIMIT ||
      blocked.some((term) => keyword.includes(term))
    ) {
      continue;
    }
    seen.add(keyword);
    titleKeywords.push(keyword);
    added += 1;
  }
  return { titleKeywords, added };
}

export function buildKeywordElonTitleKeywordReservoirV8(input: {
  candidates: KeywordElonCandidate[];
  allowedKeys: string[];
  fallbackKeywords?: string[];
  blockedKeys?: string[];
  customBlockedTerms?: string[];
  limit?: number;
}): KeywordElonTitleKeywordReservoirV8 {
  const base = buildKeywordElonTitleKeywordReservoirV8Base(input);
  const eligible = sparseEligible(base.rankedDirectKeywords);
  const requestedLimit = Math.max(
    2,
    Math.min(
      TITLE_RESERVOIR_CAPACITY_V11,
      Math.trunc(Number(input.limit) || 12),
    ),
  );
  // The external Shopling search field is ten terms, but the internal title material
  // reservoir must not discard good verified terms merely because there are more than
  // ten. Preserve every eligible direct keyword up to the 29-market portfolio size.
  const reservoirLimit = Math.min(
    TITLE_RESERVOIR_CAPACITY_V11,
    Math.max(requestedLimit, eligible.length),
  );
  const titleKeywords = [...base.titleKeywords];
  const seen = new Set(titleKeywords.map(compactKeywordElonKey).filter(Boolean));
  let rescuedDirectCount = 0;

  for (const row of eligible) {
    if (titleKeywords.length >= reservoirLimit) break;
    const key = compactKeywordElonKey(row.keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    titleKeywords.push(row.keyword);
    rescuedDirectCount += 1;
  }

  const fallback = appendGroundedFallbacks({
    titleKeywords,
    fallbackKeywords: input.fallbackKeywords,
    blockedKeys: input.blockedKeys,
    customBlockedTerms: input.customBlockedTerms,
  });

  const warnings = (base.warnings ?? []).filter(
    (warning) =>
      !warning.startsWith("SEO_KEYWORD_V8_EXCELLENT_TITLE_POOL:") &&
      !warning.startsWith("SEO_KEYWORD_V8_TITLE_PRIMARY_COUNT:") &&
      !warning.startsWith("SEO_KEYWORD_V8_TITLE_FALLBACK_COUNT:"),
  );
  warnings.push(
    `SEO_KEYWORD_V8_EXCELLENT_TITLE_POOL:${eligible.length}`,
    `SEO_KEYWORD_V8_TITLE_PRIMARY_COUNT:${fallback.titleKeywords.length}`,
    `SEO_KEYWORD_V8_TITLE_FALLBACK_COUNT:${base.fallbackTitleKeywordCount + fallback.added}`,
    `SEO_KEYWORD_V10_SPARSE_DIRECT_RESCUE:${rescuedDirectCount}`,
    `SEO_KEYWORD_V11_DIRECT_RESERVOIR_PRESERVED:${rescuedDirectCount}`,
    `SEO_KEYWORD_V11_TITLE_RESERVOIR:${fallback.titleKeywords.length}/${TITLE_RESERVOIR_CAPACITY_V11}`,
    `SEO_KEYWORD_V11_GROUNDED_SPARSE_SUPPORT:${fallback.added}`,
  );

  return {
    ...base,
    titleKeywords: fallback.titleKeywords,
    excellentDirectCount: eligible.length,
    fallbackTitleKeywordCount: base.fallbackTitleKeywordCount + fallback.added,
    warnings,
  };
}

function keywordOverlapsTitles(keyword: string, titles: string[]) {
  const key = compactKeywordElonKey(keyword);
  if (!key) return false;
  return titles.some((title) => compactKeywordElonKey(title).includes(key));
}

function uniqueSearchValues(values: unknown[], limit = 120) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = compactKeywordElonKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
    if (result.length >= limit) break;
  }
  return result;
}

export function selectKeywordElonComplementSearchKeywordsV8(input: {
  rankedDirectKeywords: KeywordElonRankedDirectKeywordV8[];
  titleTexts: string[];
  fallbackSearchKeywords?: string[];
  supplementalSearchKeywords?: string[];
  blockedKeys?: string[];
  customBlockedTerms?: string[];
  limit?: number;
}): KeywordElonComplementSearchSelectionV8 {
  const limit = Math.max(
    1,
    Math.min(
      SEARCH_KEYWORD_LIMIT,
      Math.trunc(Number(input.limit) || SEARCH_KEYWORD_LIMIT),
    ),
  );
  const blocked = new Set(blockedTerms(input));
  const directByKey = new Map(
    input.rankedDirectKeywords.map((row) => [row.key, row] as const),
  );
  const selected: string[] = [];
  const selectedKeys = new Set<string>();
  let nonOverlapCount = 0;
  let overlapFallbackCount = 0;
  let syntheticFallbackCount = 0;
  let directSelectedCount = 0;

  const add = (keyword: string, source: "direct" | "fallback") => {
    const key = compactKeywordElonKey(keyword);
    if (
      selected.length >= limit ||
      !key ||
      selectedKeys.has(key) ||
      blocked.has(key) ||
      keywordElonSeoUtf8Bytes(key) > SEARCH_TERM_BYTE_LIMIT
    ) {
      return false;
    }
    const overlaps = keywordOverlapsTitles(key, input.titleTexts);
    selectedKeys.add(key);
    selected.push(key);
    if (overlaps) overlapFallbackCount += 1;
    else nonOverlapCount += 1;
    if (source === "direct") directSelectedCount += 1;
    else if (!directByKey.has(key)) syntheticFallbackCount += 1;
    return true;
  };

  const directNonOverlap = input.rankedDirectKeywords.filter(
    (row) => !keywordOverlapsTitles(row.keyword, input.titleTexts),
  );
  const directOverlap = input.rankedDirectKeywords.filter((row) =>
    keywordOverlapsTitles(row.keyword, input.titleTexts),
  );
  const supplemental = uniqueSearchValues(input.supplementalSearchKeywords ?? []);
  const fallback = uniqueSearchValues(input.fallbackSearchKeywords ?? []);

  // V12 priority: a keyword that was actually discovered, scored and passed STEP4/V10
  // is better than a synthetic non-overlap keyword. Title/search overlap is therefore
  // a soft preference only, never a reason to push a verified direct term behind a
  // low-confidence generated phrase.
  for (const row of directNonOverlap) add(row.keyword, "direct");
  for (const row of directOverlap) add(row.keyword, "direct");

  for (const keyword of supplemental.filter(
    (value) => !keywordOverlapsTitles(value, input.titleTexts),
  )) {
    add(keyword, "fallback");
  }
  for (const keyword of fallback.filter(
    (value) => !keywordOverlapsTitles(value, input.titleTexts),
  )) {
    add(keyword, "fallback");
  }
  for (const keyword of supplemental.filter((value) =>
    keywordOverlapsTitles(value, input.titleTexts),
  )) {
    add(keyword, "fallback");
  }
  for (const keyword of fallback.filter((value) =>
    keywordOverlapsTitles(value, input.titleTexts),
  )) {
    add(keyword, "fallback");
  }

  return {
    searchKeywords: selected.slice(0, limit),
    nonOverlapCount,
    overlapFallbackCount,
    syntheticFallbackCount,
    directSelectedCount,
    warnings: [
      `SEO_KEYWORD_V8_SEARCH_COUNT:${selected.length}/${limit}`,
      `SEO_KEYWORD_V8_SEARCH_NON_OVERLAP:${nonOverlapCount}/${selected.length || 0}`,
      `SEO_KEYWORD_V8_SEARCH_OVERLAP_FALLBACK:${overlapFallbackCount}`,
      `SEO_KEYWORD_V8_SEARCH_DIRECT_COUNT:${directSelectedCount}`,
      `SEO_KEYWORD_V8_SEARCH_SYNTHETIC_FALLBACK:${syntheticFallbackCount}`,
      `SEO_KEYWORD_V12_SEARCH_PRIORITY:DIRECT_BEFORE_SYNTHETIC`,
    ],
  };
}

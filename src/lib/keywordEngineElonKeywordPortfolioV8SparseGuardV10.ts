import {
  buildKeywordElonTitleKeywordReservoirV8 as buildKeywordElonTitleKeywordReservoirV8Base,
  rankKeywordElonDirectKeywordsV8,
  selectKeywordElonComplementSearchKeywordsV8,
  type KeywordElonComplementSearchSelectionV8,
  type KeywordElonRankedDirectKeywordV8,
  type KeywordElonTitleKeywordReservoirV8,
} from "./keywordEngineElonKeywordPortfolioV8.ts";
import type { KeywordElonCandidate } from "./keywordEngineElonLabV2.ts";
import { compactKeywordElonKey } from "./keywordEngineElonLabV2.ts";
import { keywordElonSeoUtf8Bytes } from "./keywordEngineElonLabSeoOutput.ts";

export {
  rankKeywordElonDirectKeywordsV8,
  selectKeywordElonComplementSearchKeywordsV8,
};
export type {
  KeywordElonComplementSearchSelectionV8,
  KeywordElonRankedDirectKeywordV8,
  KeywordElonTitleKeywordReservoirV8,
};

const TITLE_RESERVOIR_CAPACITY_V11 = 29;
const SAME_MALL_MIN_TITLE_MATERIALS_V11 = 4;
const SEARCH_TERM_BYTE_LIMIT = 30;

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
  // `limit` used to behave as a hard cap (normally 12). V11 treats it as the
  // minimum desired working size and preserves every already STEP4-approved,
  // highly relevant direct keyword up to the natural 29-market portfolio capacity.
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

  // Sparse products need enough factual material to make unique titles for the
  // largest same-mall account family (currently four). These fallback terms are
  // supplied from already grounded/filtered FINAL or identity material upstream.
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

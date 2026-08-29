import {
  buildKeywordElonTitleKeywordReservoirV8 as buildKeywordElonTitleKeywordReservoirV8Base,
  rankKeywordElonDirectKeywordsV8,
  selectKeywordElonComplementSearchKeywordsV8,
  type KeywordElonComplementSearchSelectionV8,
  type KeywordElonRankedDirectKeywordV8,
  type KeywordElonTitleKeywordReservoirV8,
} from "./keywordEngineElonKeywordPortfolioV8.ts";
import type { KeywordElonCandidate } from "./keywordEngineElonLabV2.ts";

export {
  rankKeywordElonDirectKeywordsV8,
  selectKeywordElonComplementSearchKeywordsV8,
};
export type {
  KeywordElonComplementSearchSelectionV8,
  KeywordElonRankedDirectKeywordV8,
  KeywordElonTitleKeywordReservoirV8,
};

function sparseEligible(rows: KeywordElonRankedDirectKeywordV8[]) {
  return rows.filter(
    (row) =>
      row.titleEligible &&
      row.relevance >= 80 &&
      row.shoppingIntent >= 70,
  );
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

  // Demand data can be absent for otherwise excellent niche keywords. When the whole
  // safe direct pool is small, keeping only the two demand-measured terms creates
  // near-identical 29-title portfolios. In that sparse case, keep every already
  // STEP4-approved, title-eligible, high-relevance direct term as title material.
  if (
    base.rankedDirectKeywords.length > 7 ||
    eligible.length <= base.titleKeywords.length
  ) {
    return base;
  }

  const limit = Math.max(2, Math.min(12, Math.trunc(Number(input.limit) || 12)));
  const titleKeywords = [...base.titleKeywords];
  const seen = new Set(titleKeywords);
  for (const row of eligible) {
    if (titleKeywords.length >= limit || seen.has(row.keyword)) continue;
    seen.add(row.keyword);
    titleKeywords.push(row.keyword);
  }

  const warnings = (base.warnings ?? []).filter(
    (warning) =>
      !warning.startsWith("SEO_KEYWORD_V8_EXCELLENT_TITLE_POOL:") &&
      !warning.startsWith("SEO_KEYWORD_V8_TITLE_PRIMARY_COUNT:"),
  );
  warnings.push(
    `SEO_KEYWORD_V8_EXCELLENT_TITLE_POOL:${eligible.length}`,
    `SEO_KEYWORD_V8_TITLE_PRIMARY_COUNT:${titleKeywords.length}`,
    `SEO_KEYWORD_V10_SPARSE_DIRECT_RESCUE:${titleKeywords.length - base.titleKeywords.length}`,
  );

  return {
    ...base,
    titleKeywords,
    excellentDirectCount: eligible.length,
    warnings,
  };
}

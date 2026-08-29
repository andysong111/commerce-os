import {
  compactKeywordElonKey,
  type KeywordElonCandidate,
} from "./keywordEngineElonLabV2.ts";
import { keywordElonSeoUtf8Bytes } from "./keywordEngineElonLabSeoOutput.ts";

const TITLE_RESERVOIR_LIMIT = 12;
const SEARCH_KEYWORD_LIMIT = 10;
const SEARCH_TERM_BYTE_LIMIT = 30;

type CandidateSignals = KeywordElonCandidate & {
  intentClass?: string;
  categoryAligned?: boolean;
  categoryMatch?: number;
};

export type KeywordElonRankedDirectKeywordV8 = {
  keyword: string;
  key: string;
  score: number;
  relevance: number;
  shoppingIntent: number;
  specificity: number;
  qualityScore: number;
  demandScore: number;
  competitionOpportunity: number;
  totalSearch: number | null;
  titleEligible: boolean;
  intentClass: string;
};

export type KeywordElonTitleKeywordReservoirV8 = {
  titleKeywords: string[];
  rankedDirectKeywords: KeywordElonRankedDirectKeywordV8[];
  excellentDirectCount: number;
  fallbackTitleKeywordCount: number;
  warnings: string[];
};

export type KeywordElonComplementSearchSelectionV8 = {
  searchKeywords: string[];
  nonOverlapCount: number;
  overlapFallbackCount: number;
  syntheticFallbackCount: number;
  directSelectedCount: number;
  warnings: string[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function number100(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
}

function uniqueKeywords(values: unknown[], limit = 200) {
  const rows: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const keyword = text(value);
    const key = compactKeywordElonKey(keyword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(keyword);
    if (rows.length >= limit) break;
  }
  return rows;
}

function candidateKeyword(row: KeywordElonCandidate) {
  return text(row.searchKeyword || row.searchKey || row.keyword);
}

function candidateScore(row: KeywordElonCandidate) {
  return (
    number100(row.relevance) * 0.30 +
    number100(row.qualityScore) * 0.24 +
    number100(row.shoppingIntent) * 0.15 +
    number100(row.specificity) * 0.12 +
    number100(row.demandScore) * 0.09 +
    number100(row.competitionOpportunity) * 0.10
  );
}

function bigrams(value: string) {
  const key = compactKeywordElonKey(value);
  if (key.length < 2) return new Set(key ? [key] : []);
  const result = new Set<string>();
  for (let index = 0; index < key.length - 1; index += 1) {
    result.add(key.slice(index, index + 2));
  }
  return result;
}

function lexicalSimilarity(left: string, right: string) {
  const aKey = compactKeywordElonKey(left);
  const bKey = compactKeywordElonKey(right);
  if (!aKey || !bKey) return 0;
  if (aKey === bKey) return 1;
  if (
    Math.min(aKey.length, bKey.length) >= 3 &&
    (aKey.includes(bKey) || bKey.includes(aKey))
  ) {
    return 0.86;
  }
  const a = bigrams(aKey);
  const b = bigrams(bKey);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function maxKeywordSimilarity(keyword: string, selected: string[]) {
  let maximum = 0;
  for (const current of selected) {
    maximum = Math.max(maximum, lexicalSimilarity(keyword, current));
    if (maximum >= 1) break;
  }
  return maximum;
}

function normalizeBlockedKeys(values: unknown[]) {
  return new Set(values.map(compactKeywordElonKey).filter((value) => value.length >= 2));
}

export function rankKeywordElonDirectKeywordsV8(input: {
  candidates: KeywordElonCandidate[];
  allowedKeys: string[];
  blockedKeys?: string[];
  customBlockedTerms?: string[];
}) {
  const allowed = new Set(input.allowedKeys.map(compactKeywordElonKey).filter(Boolean));
  const blocked = normalizeBlockedKeys([
    ...(input.blockedKeys ?? []),
    ...(input.customBlockedTerms ?? []),
  ]);
  const byKey = new Map<string, KeywordElonRankedDirectKeywordV8>();

  for (const candidate of input.candidates) {
    const keyword = candidateKeyword(candidate);
    const key = compactKeywordElonKey(keyword);
    if (
      !key ||
      !allowed.has(key) ||
      !candidate.safetyPass ||
      blocked.has(key) ||
      keywordElonSeoUtf8Bytes(key) > SEARCH_TERM_BYTE_LIMIT
    ) {
      continue;
    }
    const signals = candidate as CandidateSignals;
    const ranked: KeywordElonRankedDirectKeywordV8 = {
      keyword: key,
      key,
      score: candidateScore(candidate),
      relevance: number100(candidate.relevance),
      shoppingIntent: number100(candidate.shoppingIntent),
      specificity: number100(candidate.specificity),
      qualityScore: number100(candidate.qualityScore),
      demandScore: number100(candidate.demandScore),
      competitionOpportunity: number100(candidate.competitionOpportunity),
      totalSearch:
        candidate.totalSearch === null || !Number.isFinite(Number(candidate.totalSearch))
          ? null
          : Math.max(0, Number(candidate.totalSearch)),
      titleEligible: candidate.titleEligible === true,
      intentClass: text(signals.intentClass) || "other",
    };
    const current = byKey.get(key);
    if (!current || ranked.score > current.score) byKey.set(key, ranked);
  }

  return [...byKey.values()].sort(
    (left, right) =>
      right.score - left.score ||
      right.relevance - left.relevance ||
      (right.totalSearch ?? -1) - (left.totalSearch ?? -1) ||
      right.competitionOpportunity - left.competitionOpportunity ||
      left.keyword.localeCompare(right.keyword, "ko"),
  );
}

function excellentTitleRows(rows: KeywordElonRankedDirectKeywordV8[]) {
  const strict = rows.filter(
    (row) =>
      row.titleEligible &&
      row.relevance >= 85 &&
      row.shoppingIntent >= 70 &&
      row.qualityScore >= 60,
  );
  if (strict.length >= 4) return strict;
  const relaxed = rows.filter(
    (row) =>
      row.titleEligible &&
      row.relevance >= 80 &&
      row.shoppingIntent >= 70 &&
      row.qualityScore >= 55,
  );
  if (relaxed.length >= 2) return relaxed;
  const eligible = rows.filter((row) => row.titleEligible);
  return eligible.length >= 2 ? eligible : rows;
}

export function buildKeywordElonTitleKeywordReservoirV8(input: {
  candidates: KeywordElonCandidate[];
  allowedKeys: string[];
  fallbackKeywords?: string[];
  blockedKeys?: string[];
  customBlockedTerms?: string[];
  limit?: number;
}): KeywordElonTitleKeywordReservoirV8 {
  const rankedDirectKeywords = rankKeywordElonDirectKeywordsV8(input);
  const excellent = excellentTitleRows(rankedDirectKeywords);
  const limit = Math.max(
    2,
    Math.min(TITLE_RESERVOIR_LIMIT, Math.trunc(Number(input.limit) || TITLE_RESERVOIR_LIMIT)),
  );
  const titleKeywords: string[] = [];
  const remaining = [...excellent];

  // Greedy diversity pass: high-score direct keywords remain primary, while near-identical
  // synonyms are gently delayed so good use/form/function terms are not crowded out.
  while (titleKeywords.length < limit && remaining.length) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const row = remaining[index];
      const similarity = maxKeywordSimilarity(row.keyword, titleKeywords);
      const adjusted = row.score - Math.max(0, similarity - 0.35) * 22;
      if (
        adjusted > bestScore ||
        (adjusted === bestScore &&
          row.keyword.localeCompare(remaining[bestIndex]?.keyword ?? "", "ko") < 0)
      ) {
        bestScore = adjusted;
        bestIndex = index;
      }
    }
    const [selected] = remaining.splice(bestIndex, 1);
    if (selected) titleKeywords.push(selected.keyword);
  }

  const directKeySet = new Set(titleKeywords.map(compactKeywordElonKey));
  let fallbackTitleKeywordCount = 0;
  if (titleKeywords.length < 2) {
    for (const keyword of uniqueKeywords(input.fallbackKeywords ?? [], limit)) {
      const key = compactKeywordElonKey(keyword);
      if (!key || directKeySet.has(key)) continue;
      directKeySet.add(key);
      titleKeywords.push(key);
      fallbackTitleKeywordCount += 1;
      if (titleKeywords.length >= 2) break;
    }
  }

  return {
    titleKeywords,
    rankedDirectKeywords,
    excellentDirectCount: excellent.length,
    fallbackTitleKeywordCount,
    warnings: [
      `SEO_KEYWORD_V8_DIRECT_ALLOWED:${rankedDirectKeywords.length}`,
      `SEO_KEYWORD_V8_EXCELLENT_TITLE_POOL:${excellent.length}`,
      `SEO_KEYWORD_V8_TITLE_PRIMARY_COUNT:${titleKeywords.length}`,
      `SEO_KEYWORD_V8_TITLE_FALLBACK_COUNT:${fallbackTitleKeywordCount}`,
    ],
  };
}

function keywordOverlapsTitles(keyword: string, titles: string[]) {
  const key = compactKeywordElonKey(keyword);
  if (!key) return false;
  return titles.some((title) => compactKeywordElonKey(title).includes(key));
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
    Math.min(SEARCH_KEYWORD_LIMIT, Math.trunc(Number(input.limit) || SEARCH_KEYWORD_LIMIT)),
  );
  const blocked = normalizeBlockedKeys([
    ...(input.blockedKeys ?? []),
    ...(input.customBlockedTerms ?? []),
  ]);
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
  for (const row of directNonOverlap) add(row.keyword, "direct");

  // Safe recovery supplements are preferred before reusing title keywords. They already
  // pass the existing recovery safety filter upstream.
  const supplemental = uniqueKeywords(input.supplementalSearchKeywords ?? [], 120);
  for (const keyword of supplemental.filter(
    (value) => !keywordOverlapsTitles(value, input.titleTexts),
  )) {
    add(keyword, "fallback");
  }

  // If there are not enough distinct discovery terms, overlap is allowed as requested.
  for (const row of directOverlap) add(row.keyword, "direct");

  const fallback = uniqueKeywords(input.fallbackSearchKeywords ?? [], 120);
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
    ],
  };
}

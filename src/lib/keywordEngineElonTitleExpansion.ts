import {
  compactKeywordElonKey,
  type KeywordElonCandidate,
} from "@/lib/keywordEngineElonLabV2";

export const KEYWORD_ELON_TITLE_EXPANSION_LIMIT = 30;
export const KEYWORD_ELON_CATEGORY_MATCH_GATE = 85;
export const KEYWORD_ELON_TITLE_RELEVANCE_GATE = 85;

export const KEYWORD_ELON_TITLE_INTENT_CLASSES = [
  "core_synonym",
  "use",
  "context",
  "function",
  "form",
  "category_tail",
  "other",
] as const;

export type KeywordElonTitleIntentClass =
  (typeof KEYWORD_ELON_TITLE_INTENT_CLASSES)[number];

export type KeywordElonTitleExpansionMaterial = {
  keyword: string;
  intentClass: KeywordElonTitleIntentClass;
  categoryAligned: true;
  categoryMatch: number;
  relevance: number;
  shoppingIntent: number;
  specificity: number;
  qualityScore: number;
  competitionOpportunity: number;
  totalSearch: number | null;
  expansionScore: number;
};

type CandidateSignals = {
  categoryAligned?: boolean;
  categoryMatch?: number;
  intentClass?: KeywordElonTitleIntentClass;
};

function clamp100(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
}

function candidateSignals(row: KeywordElonCandidate) {
  return row as KeywordElonCandidate & CandidateSignals;
}

export function normalizeKeywordElonTitleIntentClass(
  value: unknown,
): KeywordElonTitleIntentClass {
  const normalized = String(value ?? "").trim();
  return (KEYWORD_ELON_TITLE_INTENT_CLASSES as readonly string[]).includes(
    normalized,
  )
    ? (normalized as KeywordElonTitleIntentClass)
    : "other";
}

function expansionScore(row: KeywordElonCandidate, categoryMatch: number) {
  return Math.round(
    (
      categoryMatch * 0.25 +
      clamp100(row.relevance) * 0.3 +
      clamp100(row.qualityScore) * 0.2 +
      clamp100(row.competitionOpportunity) * 0.15 +
      clamp100(row.shoppingIntent) * 0.05 +
      clamp100(row.specificity) * 0.05
    ) *
      1000,
  ) / 1000;
}

export function buildKeywordElonTitleExpansionPool(input: {
  candidates: KeywordElonCandidate[];
  searchKeywords: string[];
  allowedKeys: string[];
  category: string;
  limit?: number;
}): KeywordElonTitleExpansionMaterial[] {
  const category = String(input.category ?? "").trim();
  if (!category) return [];

  const finalKeys = new Set(
    input.searchKeywords.map(compactKeywordElonKey).filter(Boolean),
  );
  const allowed = new Set(
    input.allowedKeys.map(compactKeywordElonKey).filter(Boolean),
  );
  const seen = new Set<string>();
  const rows: KeywordElonTitleExpansionMaterial[] = [];

  for (const row of input.candidates) {
    const keyword = compactKeywordElonKey(
      row.searchKeyword || row.searchKey || row.keyword,
    );
    if (
      !keyword ||
      seen.has(keyword) ||
      finalKeys.has(keyword) ||
      !allowed.has(keyword) ||
      !row.safetyPass ||
      !row.titleEligible
    ) {
      continue;
    }
    const signals = candidateSignals(row);
    const categoryMatch = clamp100(signals.categoryMatch);
    if (
      signals.categoryAligned !== true ||
      categoryMatch < KEYWORD_ELON_CATEGORY_MATCH_GATE ||
      clamp100(row.relevance) < KEYWORD_ELON_TITLE_RELEVANCE_GATE ||
      clamp100(row.shoppingIntent) < 70 ||
      clamp100(row.qualityScore) < 60
    ) {
      continue;
    }
    seen.add(keyword);
    rows.push({
      keyword,
      intentClass: normalizeKeywordElonTitleIntentClass(signals.intentClass),
      categoryAligned: true,
      categoryMatch,
      relevance: clamp100(row.relevance),
      shoppingIntent: clamp100(row.shoppingIntent),
      specificity: clamp100(row.specificity),
      qualityScore: clamp100(row.qualityScore),
      competitionOpportunity: clamp100(row.competitionOpportunity),
      totalSearch:
        row.totalSearch === null || !Number.isFinite(Number(row.totalSearch))
          ? null
          : Math.max(0, Number(row.totalSearch)),
      expansionScore: expansionScore(row, categoryMatch),
    });
  }

  rows.sort(
    (a, b) =>
      b.expansionScore - a.expansionScore ||
      b.relevance - a.relevance ||
      (b.totalSearch ?? -1) - (a.totalSearch ?? -1) ||
      b.competitionOpportunity - a.competitionOpportunity ||
      a.keyword.localeCompare(b.keyword, "ko"),
  );

  const limit = Math.max(
    0,
    Math.min(
      KEYWORD_ELON_TITLE_EXPANSION_LIMIT,
      Math.trunc(Number(input.limit) || KEYWORD_ELON_TITLE_EXPANSION_LIMIT),
    ),
  );
  const buckets = new Map<
    KeywordElonTitleIntentClass,
    KeywordElonTitleExpansionMaterial[]
  >();
  for (const intent of KEYWORD_ELON_TITLE_INTENT_CLASSES) buckets.set(intent, []);
  for (const row of rows) buckets.get(row.intentClass)?.push(row);

  const selected: KeywordElonTitleExpansionMaterial[] = [];
  let cursor = 0;
  while (selected.length < limit) {
    let added = false;
    for (const intent of KEYWORD_ELON_TITLE_INTENT_CLASSES) {
      const row = buckets.get(intent)?.[cursor];
      if (!row) continue;
      selected.push(row);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
    cursor += 1;
  }
  return selected;
}

import {
  composeKeywordElonSafeMallTitles,
  type KeywordElonMallTitleFactContext,
  type KeywordElonMallTitleSafeComposerResult,
} from "./keywordEngineElonMallTitleSafeComposer";
import type { KeywordElonSeoMarket } from "./keywordEngineElonLabSeoOutput";
import type { KeywordElonTitleExpansionMaterial } from "./keywordEngineElonTitleExpansion";

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function canonical(value: unknown) {
  return text(value).replace(/\s+/g, "").toLowerCase();
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rotate<T>(values: T[], offset: number) {
  if (!values.length) return values;
  const normalized = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
}

function tokenSet(value: string) {
  return new Set(
    text(value)
      .split(/\s+/)
      .map(canonical)
      .filter(Boolean),
  );
}

function jaccard(left: string, right: string) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function freshnessScore(
  result: KeywordElonMallTitleSafeComposerResult,
  excludedTitles: string[],
) {
  if (!excludedTitles.length) return 0;
  const excludedCanonical = new Set(excludedTitles.map(canonical).filter(Boolean));
  let exact = 0;
  let reorderOnly = 0;
  let similarity = 0;
  for (const row of result.rows) {
    const rowCanonical = canonical(row.title);
    if (excludedCanonical.has(rowCanonical)) exact += 1;
    let maxSimilarity = 0;
    for (const previous of excludedTitles) {
      maxSimilarity = Math.max(maxSimilarity, jaccard(row.title, previous));
      if (maxSimilarity >= 1) break;
    }
    if (maxSimilarity >= 0.999 && !excludedCanonical.has(rowCanonical)) reorderOnly += 1;
    similarity += maxSimilarity;
  }
  return exact * 100_000 + reorderOnly * 20_000 + similarity * 100;
}

export function composeFreshKeywordElonMallTitles(input: {
  markets: KeywordElonSeoMarket[];
  finalKeywords: string[];
  titleExpansionPool?: KeywordElonTitleExpansionMaterial[];
  modelName: string;
  context: KeywordElonMallTitleFactContext;
  blockedTerms?: string[];
  excludedTitles?: string[];
  variationSeed?: string;
}): KeywordElonMallTitleSafeComposerResult {
  const finals = [...input.finalKeywords];
  const expansion = [...(input.titleExpansionPool ?? [])];
  const excludedTitles = [...new Set((input.excludedTitles ?? []).map(text).filter(Boolean))].slice(0, 1200);
  const seed = stableHash(input.variationSeed || `${input.context.modelNumber ?? ""}:${Date.now()}`);
  const attempts = Math.min(18, Math.max(8, finals.length + Math.min(expansion.length, 8)));
  let best: KeywordElonMallTitleSafeComposerResult | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestAttempt = 0;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const finalOffset = finals.length ? (seed + attempt * 3) % finals.length : 0;
    const expansionOffset = expansion.length ? (seed * 7 + attempt * 5) % expansion.length : 0;
    const result = composeKeywordElonSafeMallTitles({
      markets: input.markets,
      finalKeywords: rotate(finals, finalOffset),
      titleExpansionPool: rotate(expansion, expansionOffset),
      modelName: input.modelName,
      context: input.context,
      blockedTerms: input.blockedTerms,
    });
    const score = freshnessScore(result, excludedTitles);
    if (score < bestScore) {
      best = result;
      bestScore = score;
      bestAttempt = attempt;
    }
    if (score === 0) break;
  }

  if (!best) {
    throw new Error("SEO 회차 상품명 후보를 만들지 못했습니다.");
  }

  const excludedCanonical = new Set(excludedTitles.map(canonical).filter(Boolean));
  const exactReuse = best.rows.filter((row) => excludedCanonical.has(canonical(row.title))).length;
  let reorderOnly = 0;
  for (const row of best.rows) {
    if (excludedCanonical.has(canonical(row.title))) continue;
    if (excludedTitles.some((previous) => jaccard(row.title, previous) >= 0.999)) reorderOnly += 1;
  }

  return {
    ...best,
    warnings: [
      ...best.warnings,
      `SEO_RUN_FRESH_VARIATION_ATTEMPT:${bestAttempt + 1}/${attempts}`,
      `SEO_RUN_EXCLUDED_TITLE_COUNT:${excludedTitles.length}`,
      `SEO_RUN_EXACT_TITLE_REUSE:${exactReuse}`,
      `SEO_RUN_REORDER_ONLY_REUSE:${reorderOnly}`,
    ],
  };
}

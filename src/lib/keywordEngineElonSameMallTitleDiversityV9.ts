import {
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
} from "./keywordEngineElonLabSeoOutput.ts";
import {
  keywordElonMallTitleSemanticSimilarity,
} from "./keywordEngineElonMallTitleDiversityV8.ts";
import type {
  KeywordElonMallTitleSafeComposerResult,
  KeywordElonSafeMallTitleRow,
} from "./keywordEngineElonMallTitleSafeComposer.ts";

const SAME_MALL_PREFERRED_MAX_SIMILARITY = 0.58;
const SAME_MALL_NEAR_DUPLICATE_SIMILARITY = 0.72;

type SameMallMetrics = {
  nearDuplicateCount: number;
  maxSimilarity: number;
  averageSimilarity: number;
};

type Candidate = {
  row: KeywordElonSafeMallTitleRow;
  canonical: string;
  leadKey: string;
  materialKeys: string[];
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function leadKey(value: string) {
  return keywordElonSeoCanonical(text(value).split(/\s+/)[0] ?? "");
}

function descriptor(row: KeywordElonSafeMallTitleRow): Candidate {
  return {
    row,
    canonical: keywordElonSeoCanonical(row.title),
    leadKey: leadKey(row.title),
    materialKeys: [
      ...new Set(
        row.keywordMaterials
          .map(keywordElonSeoCanonical)
          .filter(Boolean),
      ),
    ],
  };
}

function maxSimilarity(title: string, others: string[]) {
  let maximum = 0;
  for (const other of others) {
    maximum = Math.max(
      maximum,
      keywordElonMallTitleSemanticSimilarity(title, other),
    );
    if (maximum >= 0.999) break;
  }
  return maximum;
}

function sameMallMetrics(rows: KeywordElonSafeMallTitleRow[]): SameMallMetrics {
  let nearDuplicateCount = 0;
  let maxPortfolioSimilarity = 0;
  let similarityTotal = 0;
  let comparableCount = 0;
  const previousByMall = new Map<string, string[]>();

  for (const row of rows) {
    const mallKey = text(row.mallKey);
    const previous = previousByMall.get(mallKey) ?? [];
    if (previous.length) {
      const similarity = maxSimilarity(row.title, previous);
      maxPortfolioSimilarity = Math.max(maxPortfolioSimilarity, similarity);
      similarityTotal += similarity;
      comparableCount += 1;
      if (similarity >= SAME_MALL_NEAR_DUPLICATE_SIMILARITY) {
        nearDuplicateCount += 1;
      }
    }
    previous.push(row.title);
    previousByMall.set(mallKey, previous);
  }

  return {
    nearDuplicateCount,
    maxSimilarity: maxPortfolioSimilarity,
    averageSimilarity: comparableCount ? similarityTotal / comparableCount : 0,
  };
}

function metricScore(metrics: SameMallMetrics) {
  return (
    metrics.nearDuplicateCount * 100_000 +
    metrics.maxSimilarity * 1_000 +
    metrics.averageSimilarity * 100
  );
}

function sameMallSimilarityPenalty(value: number) {
  if (value >= 0.92) return 50_000;
  if (value >= 0.84) return 18_000;
  if (value >= 0.72) return 6_000;
  if (value >= 0.66) return 2_000;
  if (value >= 0.58) return 650;
  return value * 70;
}

function candidateScore(input: {
  candidate: Candidate;
  original: KeywordElonSafeMallTitleRow;
  selectedRows: KeywordElonSafeMallTitleRow[];
}) {
  const sameMallRows = input.selectedRows.filter(
    (row) => text(row.mallKey) === text(input.original.mallKey),
  );
  const sameMallTitles = sameMallRows.map((row) => row.title);
  const otherTitles = input.selectedRows
    .filter((row) => text(row.mallKey) !== text(input.original.mallKey))
    .map((row) => row.title);
  const sameMallSimilarity = maxSimilarity(
    input.candidate.row.title,
    sameMallTitles,
  );
  const globalSimilarity = maxSimilarity(input.candidate.row.title, otherTitles);
  const sameMallLeadCount = sameMallRows.filter(
    (row) => leadKey(row.title) === input.candidate.leadKey,
  ).length;
  const originalBias =
    input.candidate.canonical === keywordElonSeoCanonical(input.original.title)
      ? -1.5
      : 0;

  return (
    sameMallSimilarityPenalty(sameMallSimilarity) +
    globalSimilarity * 12 +
    sameMallLeadCount * 180 +
    originalBias
  );
}

function rotateWords(value: string, offset: number) {
  const words = text(value).split(/\s+/).filter(Boolean);
  if (words.length < 3) return text(value);
  const normalized = ((offset % words.length) + words.length) % words.length;
  if (!normalized) return text(value);
  return [...words.slice(normalized), ...words.slice(0, normalized)].join(" ");
}

function applyVisibleOrderFallback(rows: KeywordElonSafeMallTitleRow[]) {
  const result = rows.map((row) => ({ ...row }));
  const usedCanonical = new Set(
    result.map((row) => keywordElonSeoCanonical(row.title)).filter(Boolean),
  );
  const previousByMall = new Map<string, KeywordElonSafeMallTitleRow[]>();
  let fallbackCount = 0;

  for (let index = 0; index < result.length; index += 1) {
    const row = result[index];
    const mallKey = text(row.mallKey);
    const previous = previousByMall.get(mallKey) ?? [];
    const similarity = maxSimilarity(
      row.title,
      previous.map((entry) => entry.title),
    );

    if (
      previous.length &&
      similarity >= SAME_MALL_NEAR_DUPLICATE_SIMILARITY
    ) {
      const originalCanonical = keywordElonSeoCanonical(row.title);
      const words = text(row.title).split(/\s+/).filter(Boolean);
      for (let offset = 1; offset < words.length; offset += 1) {
        const rotated = rotateWords(row.title, offset + previous.length - 1);
        const rotatedCanonical = keywordElonSeoCanonical(rotated);
        if (
          !rotatedCanonical ||
          rotatedCanonical === originalCanonical ||
          usedCanonical.has(rotatedCanonical)
        ) {
          continue;
        }
        usedCanonical.delete(originalCanonical);
        usedCanonical.add(rotatedCanonical);
        row.title = rotated;
        row.byteLength = keywordElonSeoUtf8Bytes(rotated);
        row.modelPosition =
          text(row.modelName) && rotated.startsWith(text(row.modelName))
            ? "first"
            : "after_lead";
        row.strategyLabel = "same-mall-diversity-v9-order-fallback";
        fallbackCount += 1;
        break;
      }
    }

    previous.push(row);
    previousByMall.set(mallKey, previous);
  }

  return { rows: result, fallbackCount };
}

function roundMetric(value: number) {
  return Math.round(value * 1000) / 1000;
}

function appendWarnings(
  result: KeywordElonMallTitleSafeComposerResult,
  metrics: SameMallMetrics,
  status: "applied" | "kept",
  fallbackCount: number,
) {
  return {
    ...result,
    warnings: [
      ...result.warnings.filter(
        (warning) =>
          !warning.startsWith("SEO_SAME_MALL_DIVERSITY_V9:"),
      ),
      `SEO_SAME_MALL_DIVERSITY_V9:${status}`,
      `SEO_SAME_MALL_DIVERSITY_V9_NEAR_DUPLICATES:${metrics.nearDuplicateCount}`,
      `SEO_SAME_MALL_DIVERSITY_V9_MAX_SIMILARITY:${roundMetric(metrics.maxSimilarity)}`,
      `SEO_SAME_MALL_DIVERSITY_V9_AVG_SIMILARITY:${roundMetric(metrics.averageSimilarity)}`,
      `SEO_SAME_MALL_DIVERSITY_V9_ORDER_FALLBACK:${fallbackCount}`,
    ],
  };
}

export function rebalanceKeywordElonSameMallTitleDiversityV9(input: {
  attempts: KeywordElonMallTitleSafeComposerResult[];
  selected: KeywordElonMallTitleSafeComposerResult;
  finalKeywords: string[];
}): KeywordElonMallTitleSafeComposerResult {
  const selected = input.selected;
  if (!selected.rows.length) return selected;
  const attempts = input.attempts.filter(
    (attempt) => attempt.rows.length === selected.rows.length,
  );
  if (!attempts.length) return selected;

  const finalKeys = input.finalKeywords
    .map(keywordElonSeoCanonical)
    .filter(Boolean);
  const candidateRows = selected.rows.map((original, rowIndex) => {
    const seen = new Set<string>();
    const candidates: Candidate[] = [];
    for (const row of [
      original,
      ...attempts.map((attempt) => attempt.rows[rowIndex]).filter(Boolean),
    ]) {
      const candidate = descriptor(row);
      if (!candidate.canonical || seen.has(candidate.canonical)) continue;
      seen.add(candidate.canonical);
      candidates.push(candidate);
    }
    return candidates;
  });

  const rows: KeywordElonSafeMallTitleRow[] = [];
  const usedCanonical = new Set<string>();

  for (let rowIndex = 0; rowIndex < selected.rows.length; rowIndex += 1) {
    const original = selected.rows[rowIndex];
    const requiredFinalKey = finalKeys.length
      ? finalKeys[rowIndex % finalKeys.length]
      : "";
    let eligible = candidateRows[rowIndex].filter(
      (candidate) => !usedCanonical.has(candidate.canonical),
    );
    if (!eligible.length) return selected;

    if (requiredFinalKey) {
      const required = eligible.filter((candidate) =>
        candidate.materialKeys.includes(requiredFinalKey),
      );
      if (required.length) eligible = required;
    }

    const sameMallTitles = rows
      .filter((row) => text(row.mallKey) === text(original.mallKey))
      .map((row) => row.title);
    const preferred = eligible.filter(
      (candidate) =>
        maxSimilarity(candidate.row.title, sameMallTitles) <
        SAME_MALL_PREFERRED_MAX_SIMILARITY,
    );
    if (preferred.length) eligible = preferred;

    let best: Candidate | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of eligible) {
      const score = candidateScore({ candidate, original, selectedRows: rows });
      if (
        score < bestScore ||
        (score === bestScore &&
          (!best || candidate.canonical.localeCompare(best.canonical, "ko") < 0))
      ) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) return selected;

    usedCanonical.add(best.canonical);
    rows.push({
      ...best.row,
      strategyLabel: "same-mall-diversity-v9",
      variantIndex: rowIndex,
    });
  }

  const uniqueTitleCount = new Set(
    rows.map((row) => keywordElonSeoCanonical(row.title)),
  ).size;
  if (uniqueTitleCount !== rows.length) return selected;

  const currentMetrics = sameMallMetrics(selected.rows);
  const semanticMetrics = sameMallMetrics(rows);
  const semanticRows =
    metricScore(semanticMetrics) <= metricScore(currentMetrics) + 0.001
      ? rows
      : selected.rows;
  const visibleFallback = applyVisibleOrderFallback(semanticRows);
  const finalMetrics = sameMallMetrics(visibleFallback.rows);
  const result: KeywordElonMallTitleSafeComposerResult = {
    ...selected,
    rows: visibleFallback.rows,
    uniqueTitleCount: new Set(
      visibleFallback.rows.map((row) => keywordElonSeoCanonical(row.title)),
    ).size,
  };

  if (result.uniqueTitleCount !== result.rows.length) {
    return appendWarnings(selected, currentMetrics, "kept", 0);
  }
  return appendWarnings(
    result,
    finalMetrics,
    semanticRows === selected.rows && visibleFallback.fallbackCount === 0
      ? "kept"
      : "applied",
    visibleFallback.fallbackCount,
  );
}

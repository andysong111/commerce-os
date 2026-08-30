import {
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
} from "./keywordEngineElonLabSeoOutput.ts";
import type {
  KeywordElonMallTitleSafeComposerResult,
  KeywordElonSafeMallTitleRow,
} from "./keywordEngineElonMallTitleSafeComposer.ts";

const PREFERRED_MAX_SIMILARITY = 0.66;
const NEAR_DUPLICATE_SIMILARITY = 0.74;
const TARGET_TITLE_BYTES = 50;

type Candidate = {
  row: KeywordElonSafeMallTitleRow;
  canonical: string;
  materialKeys: string[];
  finalKeys: string[];
  expansionKeys: string[];
  leadKey: string;
};

type DiversityMetrics = {
  nearDuplicateCount: number;
  maxSimilarity: number;
  averagePreviousSimilarity: number;
};

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function tokens(value: string) {
  return [
    ...new Set(
      text(value)
        .split(/\s+/)
        .map(keywordElonSeoCanonical)
        .filter(Boolean),
    ),
  ];
}

function ngrams(value: string, size: number) {
  const normalized = keywordElonSeoCanonical(value);
  const result = new Set<string>();
  if (!normalized) return result;
  if (normalized.length <= size) {
    result.add(normalized);
    return result;
  }
  for (let index = 0; index + size <= normalized.length; index += 1) {
    result.add(normalized.slice(index, index + size));
  }
  return result;
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}

function dice(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return (2 * intersection) / (left.size + right.size);
}

export function keywordElonMallTitleSemanticSimilarity(
  left: string,
  right: string,
) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  const tokenSimilarity = jaccard(
    new Set(leftTokens),
    new Set(rightTokens),
  );
  const sortedLeft = leftTokens.slice().sort((a, b) => a.localeCompare(b, "ko")).join("");
  const sortedRight = rightTokens.slice().sort((a, b) => a.localeCompare(b, "ko")).join("");
  const sortedBigramSimilarity = dice(
    ngrams(sortedLeft, 2),
    ngrams(sortedRight, 2),
  );
  const directTrigramSimilarity = dice(
    ngrams(text(left), 3),
    ngrams(text(right), 3),
  );
  return Math.min(
    1,
    Math.max(
      tokenSimilarity,
      sortedBigramSimilarity * 0.92,
      directTrigramSimilarity * 0.78,
    ),
  );
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

function diversityMetrics(rows: KeywordElonSafeMallTitleRow[]): DiversityMetrics {
  let nearDuplicateCount = 0;
  let maxPortfolioSimilarity = 0;
  let previousSimilarityTotal = 0;
  let comparableRows = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const previousTitles = rows.slice(0, index).map((row) => row.title);
    if (!previousTitles.length) continue;
    const similarity = maxSimilarity(rows[index].title, previousTitles);
    maxPortfolioSimilarity = Math.max(maxPortfolioSimilarity, similarity);
    previousSimilarityTotal += similarity;
    comparableRows += 1;
    if (similarity >= NEAR_DUPLICATE_SIMILARITY) nearDuplicateCount += 1;
  }
  return {
    nearDuplicateCount,
    maxSimilarity: maxPortfolioSimilarity,
    averagePreviousSimilarity: comparableRows
      ? previousSimilarityTotal / comparableRows
      : 0,
  };
}

function metricScore(metrics: DiversityMetrics) {
  return (
    metrics.nearDuplicateCount * 100_000 +
    metrics.maxSimilarity * 1_000 +
    metrics.averagePreviousSimilarity * 100
  );
}

function similarityPenalty(value: number, previousRun = false) {
  const multiplier = previousRun ? 0.45 : 1;
  if (value >= 0.92) return 20_000 * multiplier;
  if (value >= 0.84) return 5_000 * multiplier;
  if (value >= 0.74) return 1_500 * multiplier;
  if (value >= 0.66) return 420 * multiplier;
  if (value >= 0.58) return 110 * multiplier;
  return value * 32 * multiplier;
}

function descriptor(
  row: KeywordElonSafeMallTitleRow,
  finalKeySet: Set<string>,
): Candidate {
  const materialKeys = [
    ...new Set(
      row.keywordMaterials
        .map(keywordElonSeoCanonical)
        .filter(Boolean),
    ),
  ];
  return {
    row,
    canonical: keywordElonSeoCanonical(row.title),
    materialKeys,
    finalKeys: materialKeys.filter((key) => finalKeySet.has(key)),
    expansionKeys: materialKeys.filter((key) => !finalKeySet.has(key)),
    leadKey: keywordElonSeoCanonical(text(row.title).split(/\s+/)[0] ?? ""),
  };
}

function candidateScore(input: {
  candidate: Candidate;
  original: KeywordElonSafeMallTitleRow;
  selectedTitles: string[];
  excludedTitles: string[];
  finalUsage: Map<string, number>;
  expansionUsage: Map<string, number>;
  materialUsage: Map<string, number>;
  leadUsage: Map<string, number>;
  expansionAvailable: boolean;
}) {
  const selectedSimilarity = maxSimilarity(
    input.candidate.row.title,
    input.selectedTitles,
  );
  const previousRunSimilarity = maxSimilarity(
    input.candidate.row.title,
    input.excludedTitles,
  );
  const repeatedFinalPenalty = input.candidate.finalKeys.reduce(
    (sum, key) => sum + (input.finalUsage.get(key) ?? 0) * 4.5,
    0,
  );
  const repeatedExpansionPenalty = input.candidate.expansionKeys.reduce(
    (sum, key) => sum + (input.expansionUsage.get(key) ?? 0) * 11,
    0,
  );
  const repeatedMaterialPenalty = input.candidate.materialKeys.reduce(
    (sum, key) => sum + (input.materialUsage.get(key) ?? 0) * 1.4,
    0,
  );
  const leadPenalty = (input.leadUsage.get(input.candidate.leadKey) ?? 0) * 14;
  const hasUnusedExpansion = input.candidate.expansionKeys.some(
    (key) => (input.expansionUsage.get(key) ?? 0) === 0,
  );
  const hasUnusedMaterial = input.candidate.materialKeys.some(
    (key) => (input.materialUsage.get(key) ?? 0) === 0,
  );
  const expansionPenalty =
    input.expansionAvailable && input.candidate.expansionKeys.length === 0 ? 26 : 0;
  const noveltyBonus =
    (hasUnusedExpansion ? -28 : 0) +
    (hasUnusedMaterial ? -8 : 0);
  const byteLength = keywordElonSeoUtf8Bytes(input.candidate.row.title);
  const lengthPenalty = Math.abs(TARGET_TITLE_BYTES - byteLength) * 0.14;
  const originalBias =
    input.candidate.canonical === keywordElonSeoCanonical(input.original.title)
      ? -1.5
      : 0;

  return (
    similarityPenalty(selectedSimilarity) +
    similarityPenalty(previousRunSimilarity, true) +
    repeatedFinalPenalty +
    repeatedExpansionPenalty +
    repeatedMaterialPenalty +
    leadPenalty +
    expansionPenalty +
    noveltyBonus +
    lengthPenalty +
    originalBias
  );
}

function roundMetric(value: number) {
  return Math.round(value * 1000) / 1000;
}

function appendWarnings(
  result: KeywordElonMallTitleSafeComposerResult,
  metrics: DiversityMetrics,
  status: "applied" | "kept",
) {
  return {
    ...result,
    nearDuplicateCount: metrics.nearDuplicateCount,
    warnings: [
      ...result.warnings.filter(
        (warning) =>
          !warning.startsWith("SEO_MALL_TITLE_DIVERSITY_V8:") &&
          !warning.startsWith("SEO_MALL_TITLE_DIVERSITY_V8_NEAR_DUPLICATES:") &&
          !warning.startsWith("SEO_MALL_TITLE_DIVERSITY_V8_MAX_SIMILARITY:") &&
          !warning.startsWith("SEO_MALL_TITLE_DIVERSITY_V8_AVG_SIMILARITY:"),
      ),
      `SEO_MALL_TITLE_DIVERSITY_V8:${status}`,
      `SEO_MALL_TITLE_DIVERSITY_V8_NEAR_DUPLICATES:${metrics.nearDuplicateCount}`,
      `SEO_MALL_TITLE_DIVERSITY_V8_MAX_SIMILARITY:${roundMetric(metrics.maxSimilarity)}`,
      `SEO_MALL_TITLE_DIVERSITY_V8_AVG_SIMILARITY:${roundMetric(
        metrics.averagePreviousSimilarity,
      )}`,
    ],
  };
}

export function rebalanceKeywordElonMallTitleDiversityV8(input: {
  attempts: KeywordElonMallTitleSafeComposerResult[];
  selected: KeywordElonMallTitleSafeComposerResult;
  finalKeywords: string[];
  excludedTitles?: string[];
}): KeywordElonMallTitleSafeComposerResult {
  const selected = input.selected;
  if (!selected.rows.length) return selected;
  const attempts = input.attempts.filter(
    (attempt) => attempt.rows.length === selected.rows.length,
  );
  if (!attempts.length) return selected;

  const finals = [
    ...new Set(input.finalKeywords.map(text).filter(Boolean)),
  ];
  const finalKeySet = new Set(
    finals.map(keywordElonSeoCanonical).filter(Boolean),
  );
  if (!finalKeySet.size) return selected;
  const excludedTitles = [
    ...new Set((input.excludedTitles ?? []).map(text).filter(Boolean)),
  ].slice(0, 1200);

  const candidateRows = selected.rows.map((original, rowIndex) => {
    const seen = new Set<string>();
    const rows: Candidate[] = [];
    for (const row of [
      original,
      ...attempts.map((attempt) => attempt.rows[rowIndex]).filter(Boolean),
    ]) {
      const candidate = descriptor(row, finalKeySet);
      if (!candidate.canonical || seen.has(candidate.canonical)) continue;
      seen.add(candidate.canonical);
      rows.push(candidate);
    }
    return rows;
  });

  const expansionAvailable = candidateRows.some((rows) =>
    rows.some((candidate) => candidate.expansionKeys.length > 0),
  );
  const rows: KeywordElonSafeMallTitleRow[] = [];
  const usedCanonical = new Set<string>();
  const finalUsage = new Map<string, number>();
  const expansionUsage = new Map<string, number>();
  const materialUsage = new Map<string, number>();
  const leadUsage = new Map<string, number>();

  for (let rowIndex = 0; rowIndex < selected.rows.length; rowIndex += 1) {
    const original = selected.rows[rowIndex];
    const requiredFinalKey = keywordElonSeoCanonical(
      finals[rowIndex % finals.length],
    );
    let eligible = candidateRows[rowIndex].filter(
      (candidate) => !usedCanonical.has(candidate.canonical),
    );
    const requiredRows = eligible.filter((candidate) =>
      candidate.finalKeys.includes(requiredFinalKey),
    );
    if (requiredRows.length) eligible = requiredRows;
    const selectedTitles = rows.map((row) => row.title);
    const preferredRows = eligible.filter(
      (candidate) =>
        maxSimilarity(candidate.row.title, selectedTitles) <
        PREFERRED_MAX_SIMILARITY,
    );
    if (preferredRows.length) eligible = preferredRows;

    let best: Candidate | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of eligible) {
      const score = candidateScore({
        candidate,
        original,
        selectedTitles,
        excludedTitles,
        finalUsage,
        expansionUsage,
        materialUsage,
        leadUsage,
        expansionAvailable,
      });
      if (
        score < bestScore ||
        (score === bestScore &&
          (!best || candidate.canonical.localeCompare(best.canonical, "ko") < 0))
      ) {
        best = candidate;
        bestScore = score;
      }
    }
    if (!best) {
      const fallback = descriptor(original, finalKeySet);
      if (usedCanonical.has(fallback.canonical)) return selected;
      best = fallback;
    }

    usedCanonical.add(best.canonical);
    for (const key of best.finalKeys) {
      finalUsage.set(key, (finalUsage.get(key) ?? 0) + 1);
    }
    for (const key of best.expansionKeys) {
      expansionUsage.set(key, (expansionUsage.get(key) ?? 0) + 1);
    }
    for (const key of best.materialKeys) {
      materialUsage.set(key, (materialUsage.get(key) ?? 0) + 1);
    }
    if (best.leadKey) {
      leadUsage.set(best.leadKey, (leadUsage.get(best.leadKey) ?? 0) + 1);
    }
    rows.push({
      ...best.row,
      strategyLabel: "intent-portfolio-v8-diversity",
      variantIndex: rowIndex,
    });
  }

  const uniqueTitleCount = new Set(
    rows.map((row) => keywordElonSeoCanonical(row.title)),
  ).size;
  const coveredFinals = finals.filter((keyword) =>
    rows.some((row) =>
      row.keywordMaterials.some(
        (material) =>
          keywordElonSeoCanonical(material) === keywordElonSeoCanonical(keyword),
      ),
    ),
  );
  if (
    rows.length !== selected.rows.length ||
    uniqueTitleCount !== rows.length ||
    coveredFinals.length !== finals.length
  ) {
    return appendWarnings(
      selected,
      diversityMetrics(selected.rows),
      "kept",
    );
  }

  const rebalanced: KeywordElonMallTitleSafeComposerResult = {
    ...selected,
    rows,
    uniqueTitleCount,
    keywordCoverageCount: coveredFinals.length,
    keywordCoverageTotal: finals.length,
  };
  const currentMetrics = diversityMetrics(selected.rows);
  const rebalancedMetrics = diversityMetrics(rows);
  if (metricScore(rebalancedMetrics) > metricScore(currentMetrics) + 0.001) {
    return appendWarnings(selected, currentMetrics, "kept");
  }
  return appendWarnings(rebalanced, rebalancedMetrics, "applied");
}

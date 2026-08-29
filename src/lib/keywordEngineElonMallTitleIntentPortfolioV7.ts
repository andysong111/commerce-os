import {
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
} from "./keywordEngineElonLabSeoOutput.ts";
import {
  KEYWORD_ELON_LONG_TITLE_IDEAL_MIN_BYTES,
  KEYWORD_ELON_LONG_TITLE_RECOMMENDED_MIN_BYTES,
  KEYWORD_ELON_LONG_TITLE_TARGET_BYTES,
} from "./keywordEngineElonLongTitlePriority.ts";
import type {
  KeywordElonMallTitleSafeComposerResult,
  KeywordElonSafeMallTitleRow,
} from "./keywordEngineElonMallTitleSafeComposer.ts";
import type {
  KeywordElonTitleExpansionMaterial,
  KeywordElonTitleIntentClass,
} from "./keywordEngineElonTitleExpansion.ts";

type PortfolioCandidate = {
  row: KeywordElonSafeMallTitleRow;
  canonical: string;
  finalKeys: string[];
  expansionKeys: string[];
  intentClasses: KeywordElonTitleIntentClass[];
  nonCoreIntentClasses: KeywordElonTitleIntentClass[];
  expansionQuality: number;
};

const INTENT_PRIORITY: KeywordElonTitleIntentClass[] = [
  "use",
  "function",
  "category_tail",
  "context",
  "form",
];

function text(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function tokenSet(value: string) {
  return new Set(
    text(value)
      .split(/\s+/)
      .map(keywordElonSeoCanonical)
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

function nearDuplicateCount(titles: string[]) {
  let count = 0;
  for (let index = 0; index < titles.length; index += 1) {
    for (let previous = 0; previous < index; previous += 1) {
      if (jaccard(titles[index], titles[previous]) >= 0.8) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

function maxSimilarity(title: string, others: string[]) {
  let maximum = 0;
  for (const other of others) {
    maximum = Math.max(maximum, jaccard(title, other));
    if (maximum >= 0.999) break;
  }
  return maximum;
}

function lengthPenalty(byteLength: number) {
  if (byteLength >= KEYWORD_ELON_LONG_TITLE_IDEAL_MIN_BYTES) {
    return Math.abs(KEYWORD_ELON_LONG_TITLE_TARGET_BYTES - byteLength) * 0.65;
  }
  if (byteLength >= KEYWORD_ELON_LONG_TITLE_RECOMMENDED_MIN_BYTES) {
    return 7 + (KEYWORD_ELON_LONG_TITLE_IDEAL_MIN_BYTES - byteLength) * 3.5;
  }
  return (
    28 +
    (KEYWORD_ELON_LONG_TITLE_RECOMMENDED_MIN_BYTES - byteLength) * 9
  );
}

function similarityPenalty(value: number, previousRun: boolean) {
  if (value >= 0.999) return previousRun ? 5_000 : 10_000;
  if (value >= 0.9) return previousRun ? 900 : 1_500;
  if (value >= 0.8) return previousRun ? 300 : 650;
  if (value >= 0.72) return previousRun ? 70 : 160;
  return value * (previousRun ? 12 : 22);
}

function buildIntentCycle(expansionPool: KeywordElonTitleExpansionMaterial[]) {
  const counts = new Map<KeywordElonTitleIntentClass, number>();
  for (const row of expansionPool) {
    if (row.intentClass === "other" || row.intentClass === "core_synonym") continue;
    counts.set(row.intentClass, (counts.get(row.intentClass) ?? 0) + 1);
  }

  const cycle: KeywordElonTitleIntentClass[] = [];
  for (const intent of INTENT_PRIORITY) {
    const count = counts.get(intent) ?? 0;
    for (let index = 0; index < Math.min(4, count); index += 1) {
      cycle.push(intent);
    }
  }
  // General/core search intent stays represented, but does not dominate the portfolio.
  cycle.push("core_synonym", "core_synonym");
  return cycle.length ? cycle : (["core_synonym"] as KeywordElonTitleIntentClass[]);
}

function candidateDescriptor(input: {
  row: KeywordElonSafeMallTitleRow;
  finalKeys: Set<string>;
  expansionByKey: Map<string, KeywordElonTitleExpansionMaterial>;
}): PortfolioCandidate {
  const rowKeys = input.row.keywordMaterials
    .map(keywordElonSeoCanonical)
    .filter(Boolean);
  const finalKeys = [...new Set(rowKeys.filter((key) => input.finalKeys.has(key)))];
  const expansionRows = rowKeys
    .map((key) => input.expansionByKey.get(key))
    .filter((row): row is KeywordElonTitleExpansionMaterial => Boolean(row));
  const expansionKeys = [
    ...new Set(expansionRows.map((row) => keywordElonSeoCanonical(row.keyword))),
  ];
  const intentClasses = [...new Set(expansionRows.map((row) => row.intentClass))];
  const nonCoreIntentClasses = intentClasses.filter(
    (intent) => intent !== "core_synonym" && intent !== "other",
  );
  const expansionQuality = expansionRows.length
    ? expansionRows.reduce((sum, row) => sum + row.expansionScore, 0) /
      expansionRows.length
    : 0;
  return {
    row: input.row,
    canonical: keywordElonSeoCanonical(input.row.title),
    finalKeys,
    expansionKeys,
    intentClasses,
    nonCoreIntentClasses,
    expansionQuality,
  };
}

function candidateScore(input: {
  candidate: PortfolioCandidate;
  requiredFinalKey: string;
  targetIntent: KeywordElonTitleIntentClass;
  nonCoreAvailable: boolean;
  finalUsage: Map<string, number>;
  expansionUsage: Map<string, number>;
  selectedTitles: string[];
  excludedTitles: string[];
}) {
  const candidate = input.candidate;
  const requiredFinalPenalty = candidate.finalKeys.includes(input.requiredFinalKey)
    ? 0
    : 320;
  const laneMatched =
    input.targetIntent === "core_synonym"
      ? candidate.finalKeys.length > 0
      : candidate.intentClasses.includes(input.targetIntent);
  const intentLanePenalty = laneMatched
    ? input.targetIntent === "core_synonym"
      ? 0
      : -24
    : input.targetIntent === "core_synonym"
      ? 4
      : 72;
  const pureSynonymPenalty =
    input.nonCoreAvailable && candidate.nonCoreIntentClasses.length === 0 ? 34 : 0;
  const expansionPresencePenalty =
    input.nonCoreAvailable && candidate.expansionKeys.length === 0 ? 26 : 0;
  const extraFinalPenalty = Math.max(0, candidate.finalKeys.length - 2) * 7;
  const finalUsagePenalty = candidate.finalKeys.reduce(
    (sum, key) => sum + (input.finalUsage.get(key) ?? 0) * 3.2,
    0,
  );
  const expansionUsagePenalty = candidate.expansionKeys.reduce(
    (sum, key) => sum + (input.expansionUsage.get(key) ?? 0) * 4.5,
    0,
  );
  const selectedSimilarity = maxSimilarity(
    candidate.row.title,
    input.selectedTitles,
  );
  const previousRunSimilarity = maxSimilarity(
    candidate.row.title,
    input.excludedTitles,
  );
  const qualityBonus = candidate.expansionQuality ? candidate.expansionQuality * -0.045 : 0;
  const multiIntentBonus = Math.max(0, candidate.nonCoreIntentClasses.length - 1) * -4;

  return (
    requiredFinalPenalty +
    intentLanePenalty +
    pureSynonymPenalty +
    expansionPresencePenalty +
    extraFinalPenalty +
    finalUsagePenalty +
    expansionUsagePenalty +
    lengthPenalty(candidate.row.byteLength) +
    similarityPenalty(selectedSimilarity, false) +
    similarityPenalty(previousRunSimilarity, true) +
    qualityBonus +
    multiIntentBonus
  );
}

function availableNonCoreIntentCount(
  expansionPool: KeywordElonTitleExpansionMaterial[],
) {
  return new Set(
    expansionPool
      .map((row) => row.intentClass)
      .filter((intent) => intent !== "core_synonym" && intent !== "other"),
  ).size;
}

export function composeKeywordElonIntentPortfolioV7(input: {
  attempts: KeywordElonMallTitleSafeComposerResult[];
  finalKeywords: string[];
  expansionPool: KeywordElonTitleExpansionMaterial[];
  excludedTitles?: string[];
}): KeywordElonMallTitleSafeComposerResult {
  const attempts = input.attempts.filter((attempt) => attempt.rows.length > 0);
  if (!attempts.length) throw new Error("V7 상품명 포트폴리오 후보가 없습니다.");
  const rowCount = attempts[0].rows.length;
  if (!rowCount || attempts.some((attempt) => attempt.rows.length !== rowCount)) {
    throw new Error("V7 상품명 포트폴리오 후보 행 수가 일치하지 않습니다.");
  }

  const finals = [...new Set(input.finalKeywords.map(text).filter(Boolean))];
  const finalKeys = new Set(finals.map(keywordElonSeoCanonical).filter(Boolean));
  if (!finalKeys.size) throw new Error("V7 상품명 포트폴리오 FINAL 키워드가 없습니다.");
  const expansionByKey = new Map<string, KeywordElonTitleExpansionMaterial>();
  for (const row of input.expansionPool) {
    const key = keywordElonSeoCanonical(row.keyword);
    if (key && !expansionByKey.has(key)) expansionByKey.set(key, row);
  }
  const nonCoreAvailable = availableNonCoreIntentCount(input.expansionPool) > 0;
  const intentCycle = buildIntentCycle(input.expansionPool);
  const excludedTitles = [...new Set((input.excludedTitles ?? []).map(text).filter(Boolean))].slice(
    0,
    1200,
  );

  const candidateRows = Array.from({ length: rowCount }, (_, rowIndex) => {
    const seen = new Set<string>();
    const rows: PortfolioCandidate[] = [];
    for (const attempt of attempts) {
      const row = attempt.rows[rowIndex];
      if (!row) continue;
      const canonical = keywordElonSeoCanonical(row.title);
      if (!canonical || seen.has(canonical)) continue;
      seen.add(canonical);
      rows.push(
        candidateDescriptor({
          row,
          finalKeys,
          expansionByKey,
        }),
      );
    }
    return rows;
  });

  const selected: PortfolioCandidate[] = [];
  const usedCanonical = new Set<string>();
  const finalUsage = new Map<string, number>();
  const expansionUsage = new Map<string, number>();

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const requiredFinalKey = keywordElonSeoCanonical(finals[rowIndex % finals.length]);
    const targetIntent = intentCycle[rowIndex % intentCycle.length];
    const selectedTitles = selected.map((candidate) => candidate.row.title);
    let best: PortfolioCandidate | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of candidateRows[rowIndex]) {
      if (usedCanonical.has(candidate.canonical)) continue;
      const score = candidateScore({
        candidate,
        requiredFinalKey,
        targetIntent,
        nonCoreAvailable,
        finalUsage,
        expansionUsage,
        selectedTitles,
        excludedTitles,
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
      throw new Error(`V7 상품명 포트폴리오 ${rowIndex + 1}번째 후보가 부족합니다.`);
    }
    usedCanonical.add(best.canonical);
    selected.push(best);
    for (const key of best.finalKeys) {
      finalUsage.set(key, (finalUsage.get(key) ?? 0) + 1);
    }
    for (const key of best.expansionKeys) {
      expansionUsage.set(key, (expansionUsage.get(key) ?? 0) + 1);
    }
  }

  const rows = selected.map((candidate, index) => ({
    ...candidate.row,
    strategyLabel: "intent-portfolio-v7",
    variantIndex: index,
  }));
  const coveredFinals = finals.filter(
    (keyword) => (finalUsage.get(keywordElonSeoCanonical(keyword)) ?? 0) > 0,
  );
  if (coveredFinals.length !== finals.length) {
    const missing = finals.filter((keyword) => !coveredFinals.includes(keyword));
    throw new Error(`V7 상품명 FINAL 키워드 커버 실패: ${missing.join(", ")}`);
  }
  const minimumFinalUsage = Math.min(
    ...finals.map((keyword) => finalUsage.get(keywordElonSeoCanonical(keyword)) ?? 0),
  );
  const uniqueTitleCount = new Set(rows.map((row) => keywordElonSeoCanonical(row.title))).size;
  if (uniqueTitleCount !== rows.length) {
    throw new Error("V7 상품명 포트폴리오에 중복 상품명이 발생했습니다.");
  }
  const nearDuplicates = nearDuplicateCount(rows.map((row) => row.title));
  const nonCoreRows = selected.filter(
    (candidate) => candidate.nonCoreIntentClasses.length > 0,
  ).length;
  const expansionRows = selected.filter((candidate) => candidate.expansionKeys.length > 0).length;
  const recommendedLengthRows = rows.filter(
    (row) => row.byteLength >= KEYWORD_ELON_LONG_TITLE_RECOMMENDED_MIN_BYTES,
  ).length;
  const idealLengthRows = rows.filter(
    (row) => row.byteLength >= KEYWORD_ELON_LONG_TITLE_IDEAL_MIN_BYTES,
  ).length;
  const averageBytes =
    Math.round(
      (rows.reduce((sum, row) => sum + keywordElonSeoUtf8Bytes(row.title), 0) /
        rows.length) *
        1000,
    ) / 1000;
  const intentCounts = new Map<KeywordElonTitleIntentClass, number>();
  for (const candidate of selected) {
    for (const intent of candidate.nonCoreIntentClasses) {
      intentCounts.set(intent, (intentCounts.get(intent) ?? 0) + 1);
    }
  }
  const intentSummary = INTENT_PRIORITY.map(
    (intent) => `${intent}:${intentCounts.get(intent) ?? 0}`,
  ).join(",");

  return {
    rows,
    facts: attempts[0].facts,
    keywordCoverageCount: coveredFinals.length,
    keywordCoverageTotal: finals.length,
    uniqueTitleCount,
    nearDuplicateCount: nearDuplicates,
    warnings: [
      ...attempts[0].warnings.filter(
        (warning) => !warning.startsWith("SEO_MALL_TITLE_NEAR_DUPLICATES_REMAIN:"),
      ),
      "SEO_MALL_TITLE_SOURCE:INTENT_PORTFOLIO_V7",
      `SEO_MALL_TITLE_V7_ATTEMPT_POOL:${attempts.length}`,
      `SEO_MALL_TITLE_V7_FINAL_COVERAGE:${coveredFinals.length}/${finals.length}`,
      `SEO_MALL_TITLE_V7_FINAL_MIN_USAGE:${minimumFinalUsage}`,
      `SEO_MALL_TITLE_V7_NON_CORE_INTENT_ROWS:${nonCoreRows}/${rows.length}`,
      `SEO_MALL_TITLE_V7_EXPANSION_ROWS:${expansionRows}/${rows.length}`,
      `SEO_MALL_TITLE_V7_INTENT_COUNTS:${intentSummary}`,
      `SEO_MALL_TITLE_V7_RECOMMENDED_LENGTH_ROWS:${recommendedLengthRows}/${rows.length}`,
      `SEO_MALL_TITLE_V7_IDEAL_LENGTH_ROWS:${idealLengthRows}/${rows.length}`,
      `SEO_MALL_TITLE_V7_AVERAGE_BYTES:${averageBytes}`,
      `SEO_MALL_TITLE_V7_NEAR_DUPLICATES:${nearDuplicates}`,
    ],
  };
}

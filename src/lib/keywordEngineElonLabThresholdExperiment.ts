import {
  KEYWORD_ELON_V2_RELEVANCE_GATE,
  KEYWORD_ELON_V2_SHOPPING_INTENT_GATE,
  compactKeywordElonKey,
  uniqueKeywordElonCanonical,
  type KeywordElonCandidate,
  type KeywordElonDiscovery,
  type KeywordElonIdentity,
  type KeywordElonSourceDraft,
} from "@/lib/keywordEngineElonLabV2";
import { discoverKeywordElonCandidatesResilient } from "@/lib/keywordEngineElonLabV2Discovery";
import {
  mergeKeywordElonCandidates,
  mergeKeywordElonDiscovery,
} from "@/lib/keywordEngineElonLabV2Merge";
import { scoreKeywordElonCandidatesBatched } from "@/lib/keywordEngineElonLabV2Scoring";
import {
  selectKeywordElonAccuracyCandidates,
  selectKeywordElonDemandCandidates,
  selectKeywordElonStep4Union,
  type KeywordElonSelectionThresholds,
} from "@/lib/keywordEngineElonLabV2Selection";
import { expandKeywordElonFromPassing } from "@/lib/keywordEngineElonLabV2Step3";
import { filterKeywordElonProhibitedKeywords } from "@/lib/keywordEngineElonLabV2Step4";

const EXPERIMENT_MODE = process.env.KEYWORD_THRESHOLD_EXPERIMENT_LOCAL_RUN === "1";
const STEP3_SEED_LIMIT = 8;
const STEP5_OBSERVED_LIMIT = 30;
const STEP4_ENGINE_LIMIT = 120;
const EXPERIMENT_BASE_CANDIDATE_LIMIT = 240;
const EXPERIMENT_STEP3_CANDIDATE_LIMIT = 140;
const EXPERIMENT_MIN_SCORING_COVERAGE = 0.9;

export type KeywordElonThresholdExperimentConfig = {
  step2Cutoffs: number[];
  demandQualityThresholds: number[];
  accuracyRelevanceThresholds: number[];
  step3Rounds: number;
  branchConcurrency: number;
  customBlockedTerms: string[];
};

export type KeywordElonExperimentKeyword = {
  keyword: string;
  relevance: number;
  shoppingIntent: number;
  specificity: number;
  qualityScore: number;
  totalSearch: number | null;
  paths: Array<"demand" | "accuracy" | "step5_observed">;
};

type BranchRound = {
  round: number;
  seedKeywords: string[];
  newCandidateCount: number;
  newlyScoredCount: number;
  reusedScoreCount: number;
  scoringCoverage: number;
  newPassingCount: number;
  cumulativeCandidateCount: number;
  cumulativePassingCount: number;
};

type BranchResult = {
  step2Cutoff: number;
  basePassingCount: number;
  discovery: KeywordElonDiscovery;
  candidates: KeywordElonCandidate[];
  rounds: BranchRound[];
  warnings: string[];
};

type ScoreCacheResult = {
  candidates: KeywordElonCandidate[];
  newlyScoredCount: number;
  reusedScoreCount: number;
  scoringCoverage: number;
  scoringWarnings: string[];
  scoringChunkCount: number;
};

type RiskCacheEntry = {
  allowed: boolean;
};

function candidateKey(row: KeywordElonCandidate) {
  return compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword);
}

function candidateLabel(row: KeywordElonCandidate) {
  return row.searchKeyword || row.searchKey || row.keyword;
}

function experimentLog(stage: string, details: Record<string, unknown> = {}) {
  console.log(`[keyword-threshold-experiment] ${stage} ${JSON.stringify(details)}`);
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("EXPERIMENT_ABORTED_BY_CALLER");
}

function passingRows(candidates: KeywordElonCandidate[], cutoff: number) {
  return [...candidates]
    .filter((row) => row.safetyPass && row.qualityScore >= cutoff)
    .sort(
      (a, b) => b.qualityScore - a.qualityScore
        || (b.totalSearch ?? -1) - (a.totalSearch ?? -1),
    );
}

function seedRows(candidates: KeywordElonCandidate[], cutoff: number) {
  return uniqueKeywordElonCanonical(
    passingRows(candidates, cutoff).map(candidateLabel),
    STEP3_SEED_LIMIT,
  );
}

function uniqueRowsPreserveOrder(rows: KeywordElonCandidate[]) {
  const seen = new Set<string>();
  const result: KeywordElonCandidate[] = [];
  for (const row of rows) {
    const key = candidateKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

function mean(values: number[]) {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function elapsedSeconds(startedAt: number) {
  return Math.round(((Date.now() - startedAt) / 1_000) * 10) / 10;
}

function priorityTag(tags: string[]) {
  return tags.some((tag) => (
    tag === "primary_seed"
    || tag === "conditional_seed"
    || tag === "market_bridge_seed"
    || tag === "api_hub_evidence_term"
    || tag === "step3_pass_seed"
    || tag === "step3_api_hub_evidence"
  ));
}

function limitDiscoveryCandidates(
  discovery: KeywordElonDiscovery,
  limit: number,
) {
  if (!EXPERIMENT_MODE || discovery.candidates.length <= limit) return discovery;

  const statMap = new Map(
    discovery.searchAdStats.map((row) => [compactKeywordElonKey(row.keyword), row] as const),
  );
  const rows = uniqueKeywordElonCanonical(discovery.candidates, 500).map((keyword) => {
    const key = compactKeywordElonKey(keyword);
    const tags = discovery.sourceTagsByKeyword[key] ?? [];
    return {
      keyword: key,
      tags,
      priority: priorityTag(tags),
      tagCount: tags.length,
      totalSearch: statMap.get(key)?.totalSearch ?? -1,
    };
  });

  const selected: string[] = [];
  const selectedKeys = new Set<string>();
  const pushRows = (inputRows: typeof rows) => {
    for (const row of inputRows) {
      if (!row.keyword || selectedKeys.has(row.keyword)) continue;
      selectedKeys.add(row.keyword);
      selected.push(row.keyword);
      if (selected.length >= limit) break;
    }
  };

  pushRows(
    rows
      .filter((row) => row.priority)
      .sort((a, b) => b.tagCount - a.tagCount || b.totalSearch - a.totalSearch),
  );
  if (selected.length < limit) {
    pushRows(
      rows
        .filter((row) => row.totalSearch >= 0)
        .sort((a, b) => b.totalSearch - a.totalSearch || b.tagCount - a.tagCount),
    );
  }
  if (selected.length < limit) {
    pushRows(
      rows.sort(
        (a, b) => b.tagCount - a.tagCount
          || a.keyword.length - b.keyword.length
          || b.totalSearch - a.totalSearch,
      ),
    );
  }

  const selectedSet = new Set(selected);
  const sourceTagsByKeyword = Object.fromEntries(
    Object.entries(discovery.sourceTagsByKeyword)
      .filter(([key]) => selectedSet.has(compactKeywordElonKey(key))),
  );

  return {
    ...discovery,
    candidates: selected,
    sourceTagsByKeyword,
    searchAdStats: discovery.searchAdStats.filter(
      (row) => selectedSet.has(compactKeywordElonKey(row.keyword)),
    ),
    searchAdWarnings: [
      ...discovery.searchAdWarnings,
      `EXPERIMENT_CANDIDATE_BOUND: ${discovery.candidates.length} → ${selected.length}`,
    ].slice(0, 30),
  };
}

function discoverySubset(discovery: KeywordElonDiscovery, keys: Set<string>) {
  const candidates = discovery.candidates.filter((keyword) => keys.has(compactKeywordElonKey(keyword)));
  const sourceTagsByKeyword = Object.fromEntries(
    Object.entries(discovery.sourceTagsByKeyword)
      .filter(([key]) => keys.has(compactKeywordElonKey(key))),
  );
  return {
    ...discovery,
    candidates,
    sourceTagsByKeyword,
    searchAdStats: discovery.searchAdStats.filter(
      (row) => keys.has(compactKeywordElonKey(row.keyword)),
    ),
  };
}

async function scoreDiscoveryWithCache(input: {
  source: KeywordElonSourceDraft;
  identity: KeywordElonIdentity;
  discovery: KeywordElonDiscovery;
  scoreCache: Map<string, KeywordElonCandidate>;
  signal?: AbortSignal;
}): Promise<ScoreCacheResult> {
  assertNotAborted(input.signal);
  const orderedKeys = uniqueKeywordElonCanonical(input.discovery.candidates, 500);
  const missingKeys = orderedKeys.filter((key) => !input.scoreCache.has(key));
  const scoringWarnings: string[] = [];
  let scoringCoverage = 1;
  let scoringChunkCount = 0;

  if (missingKeys.length) {
    const missingSet = new Set(missingKeys);
    const scored = await scoreKeywordElonCandidatesBatched({
      source: input.source,
      identity: input.identity,
      discovery: discoverySubset(input.discovery, missingSet),
    });
    scoringWarnings.push(...scored.scoringWarnings);
    scoringCoverage = scored.scoringCoverage;
    scoringChunkCount = scored.scoringChunkCount;
    for (const row of scored.candidates) {
      input.scoreCache.set(candidateKey(row), row);
    }
  }

  assertNotAborted(input.signal);
  const candidates = orderedKeys
    .map((key) => {
      const cached = input.scoreCache.get(key);
      if (!cached) return null;
      const tags = [
        ...new Set([
          ...(cached.sourceTags ?? []),
          ...(input.discovery.sourceTagsByKeyword[key] ?? []),
        ]),
      ];
      return { ...cached, sourceTags: tags };
    })
    .filter((row): row is KeywordElonCandidate => Boolean(row));

  if (candidates.length !== orderedKeys.length) {
    throw new Error(
      `EXPERIMENT_SCORE_CACHE_GAP: ${candidates.length}/${orderedKeys.length} candidates resolved`,
    );
  }

  return {
    candidates,
    newlyScoredCount: missingKeys.length,
    reusedScoreCount: orderedKeys.length - missingKeys.length,
    scoringCoverage,
    scoringWarnings,
    scoringChunkCount,
  };
}

function buildObservedDiversityCandidates(
  candidates: KeywordElonCandidate[],
  coreKeys: Set<string>,
) {
  const safe = candidates.filter((row) => row.safetyPass && row.titleEligible);
  const demandTopKeys = new Set(
    [...safe]
      .filter((row) => row.totalSearch !== null)
      .sort((a, b) => (b.totalSearch ?? -1) - (a.totalSearch ?? -1))
      .slice(0, 12)
      .map(candidateKey),
  );
  const accuracyTopKeys = new Set(
    [...safe]
      .sort(
        (a, b) => b.relevance - a.relevance
          || b.shoppingIntent - a.shoppingIntent
          || b.specificity - a.specificity,
      )
      .slice(0, 12)
      .map(candidateKey),
  );
  const topKeys = new Set([...demandTopKeys, ...accuracyTopKeys]);
  const eligible = safe
    .filter((row) => !coreKeys.has(candidateKey(row)))
    .filter(
      (row) => row.relevance >= KEYWORD_ELON_V2_RELEVANCE_GATE
        && row.shoppingIntent >= KEYWORD_ELON_V2_SHOPPING_INTENT_GATE,
    );
  const sortRows = (rows: KeywordElonCandidate[]) => rows.sort(
    (a, b) => b.relevance - a.relevance
      || b.shoppingIntent - a.shoppingIntent
      || b.qualityScore - a.qualityScore
      || (b.totalSearch ?? -1) - (a.totalSearch ?? -1),
  );
  return [
    ...sortRows(eligible.filter((row) => !topKeys.has(candidateKey(row)))),
    ...sortRows(eligible.filter((row) => topKeys.has(candidateKey(row)))),
  ].slice(0, STEP5_OBSERVED_LIMIT);
}

function keywordResult(
  row: KeywordElonCandidate,
  paths: KeywordElonExperimentKeyword["paths"],
): KeywordElonExperimentKeyword {
  return {
    keyword: candidateLabel(row),
    relevance: Math.round(row.relevance * 10) / 10,
    shoppingIntent: Math.round(row.shoppingIntent * 10) / 10,
    specificity: Math.round(row.specificity * 10) / 10,
    qualityScore: Math.round(row.qualityScore * 10) / 10,
    totalSearch: row.totalSearch,
    paths,
  };
}

async function runStep3Branch(input: {
  source: KeywordElonSourceDraft;
  identity: KeywordElonIdentity;
  baseDiscovery: KeywordElonDiscovery;
  baseCandidates: KeywordElonCandidate[];
  scoreCache: Map<string, KeywordElonCandidate>;
  step2Cutoff: number;
  rounds: number;
  signal?: AbortSignal;
}): Promise<BranchResult> {
  const branchStartedAt = Date.now();
  let discovery = input.baseDiscovery;
  let candidates = input.baseCandidates;
  const rounds: BranchRound[] = [];
  const warnings: string[] = [];
  const basePassingCount = passingRows(candidates, input.step2Cutoff).length;

  experimentLog("branch-start", {
    cutoff: input.step2Cutoff,
    basePassingCount,
    cacheSize: input.scoreCache.size,
  });

  for (let round = 1; round <= input.rounds; round += 1) {
    assertNotAborted(input.signal);
    const roundStartedAt = Date.now();
    const seeds = seedRows(candidates, input.step2Cutoff);
    if (!seeds.length) {
      warnings.push(`STEP3_STOPPED_NO_SEED: cutoff ${input.step2Cutoff} · round ${round}`);
      experimentLog("branch-no-seed", { cutoff: input.step2Cutoff, round });
      break;
    }

    const previousKeys = new Set(candidates.map(candidateKey));
    experimentLog("round-expand-start", { cutoff: input.step2Cutoff, round, seeds });
    const expanded = await expandKeywordElonFromPassing({
      identity: input.identity,
      seedKeywords: seeds,
      existingDiscovery: discovery,
      existingCandidates: candidates,
      round,
    });
    warnings.push(...expanded.warnings);

    const boundedDiscovery = limitDiscoveryCandidates(
      expanded.discovery,
      EXPERIMENT_STEP3_CANDIDATE_LIMIT,
    );
    let newPassingCount = 0;
    let newlyScoredCount = 0;
    let reusedScoreCount = 0;
    let scoringCoverage = 1;

    if (boundedDiscovery.candidates.length > 0) {
      const scored = await scoreDiscoveryWithCache({
        source: input.source,
        identity: input.identity,
        discovery: boundedDiscovery,
        scoreCache: input.scoreCache,
        signal: input.signal,
      });
      warnings.push(...scored.scoringWarnings);
      newlyScoredCount = scored.newlyScoredCount;
      reusedScoreCount = scored.reusedScoreCount;
      scoringCoverage = scored.scoringCoverage;
      newPassingCount = scored.candidates.filter(
        (row) => row.safetyPass
          && row.qualityScore >= input.step2Cutoff
          && !previousKeys.has(candidateKey(row)),
      ).length;
      discovery = mergeKeywordElonDiscovery(discovery, boundedDiscovery);
      candidates = mergeKeywordElonCandidates(candidates, scored.candidates);
    }

    rounds.push({
      round,
      seedKeywords: seeds,
      newCandidateCount: boundedDiscovery.candidates.length,
      newlyScoredCount,
      reusedScoreCount,
      scoringCoverage,
      newPassingCount,
      cumulativeCandidateCount: candidates.length,
      cumulativePassingCount: passingRows(candidates, input.step2Cutoff).length,
    });
    experimentLog("round-complete", {
      cutoff: input.step2Cutoff,
      round,
      candidates: boundedDiscovery.candidates.length,
      newlyScoredCount,
      reusedScoreCount,
      newPassingCount,
      cumulativeCandidateCount: candidates.length,
      seconds: elapsedSeconds(roundStartedAt),
    });
  }

  experimentLog("branch-complete", {
    cutoff: input.step2Cutoff,
    rounds: rounds.length,
    finalCandidates: candidates.length,
    finalPassing: passingRows(candidates, input.step2Cutoff).length,
    cacheSize: input.scoreCache.size,
    seconds: elapsedSeconds(branchStartedAt),
  });

  return {
    step2Cutoff: input.step2Cutoff,
    basePassingCount,
    discovery,
    candidates,
    rounds,
    warnings: [...new Set(warnings)].slice(0, 50),
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
) {
  const result = new Array<R>(values.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        result[index] = await worker(values[index]);
      }
    },
  );
  await Promise.all(runners);
  return result;
}

function summarizeCombination(input: {
  branch: BranchResult;
  thresholds: KeywordElonSelectionThresholds;
  allowedKeys: Set<string>;
  checkedKeys: Set<string>;
}) {
  const demand = selectKeywordElonDemandCandidates(input.branch.candidates, input.thresholds);
  const accuracy = selectKeywordElonAccuracyCandidates(input.branch.candidates, input.thresholds);
  const union = selectKeywordElonStep4Union(input.branch.candidates, input.thresholds);
  const demandKeys = new Set(demand.map(candidateKey));
  const accuracyKeys = new Set(accuracy.map(candidateKey));
  const coreRows = union.filter((row) => input.allowedKeys.has(candidateKey(row)));
  const coreKeys = new Set(coreRows.map(candidateKey));
  const diversityCandidates = buildObservedDiversityCandidates(input.branch.candidates, coreKeys);
  const diversityRows = diversityCandidates.filter(
    (row) => input.allowedKeys.has(candidateKey(row)) && !coreKeys.has(candidateKey(row)),
  );
  const measuredSearch = coreRows
    .map((row) => row.totalSearch)
    .filter((value): value is number => value !== null);
  const uncoveredCoreCount = union.filter(
    (row) => !input.checkedKeys.has(candidateKey(row)),
  ).length;
  const uncoveredDiversityCount = diversityCandidates.filter(
    (row) => !input.checkedKeys.has(candidateKey(row)),
  ).length;

  return {
    step2Cutoff: input.branch.step2Cutoff,
    demandQuality: input.thresholds.demandQuality,
    accuracyRelevance: input.thresholds.accuracyRelevance,
    demandQualifiedCount: demand.length,
    accuracyQualifiedCount: accuracy.length,
    unionBeforeStep4Count: union.length,
    step4AllowedCoreCount: coreRows.length,
    step4RemovedOrUncoveredCount: Math.max(0, union.length - coreRows.length),
    step5ObservedCount: diversityRows.length,
    avgCoreRelevance: mean(coreRows.map((row) => row.relevance)),
    avgCoreQuality: mean(coreRows.map((row) => row.qualityScore)),
    avgMeasuredMonthlySearch: mean(measuredSearch),
    uncoveredCoreCount,
    uncoveredDiversityCount,
    coreKeywords: coreRows.map((row) => keywordResult(row, [
      ...(demandKeys.has(candidateKey(row)) ? ["demand" as const] : []),
      ...(accuracyKeys.has(candidateKey(row)) ? ["accuracy" as const] : []),
    ])),
    step5ObservedKeywords: diversityRows.map(
      (row) => keywordResult(row, ["step5_observed"]),
    ),
  };
}

async function riskFilterBranch(input: {
  branch: BranchResult;
  identity: KeywordElonIdentity;
  broadThresholds: KeywordElonSelectionThresholds;
  customBlockedTerms: string[];
  riskCache: Map<string, RiskCacheEntry>;
  signal?: AbortSignal;
}) {
  assertNotAborted(input.signal);
  const broadUnion = selectKeywordElonStep4Union(
    input.branch.candidates,
    input.broadThresholds,
  );
  const broadUnionKeys = new Set(broadUnion.map(candidateKey));
  const allDiversity = buildObservedDiversityCandidates(
    input.branch.candidates,
    broadUnionKeys,
  );
  const allRiskInput = uniqueRowsPreserveOrder([...broadUnion, ...allDiversity]);
  const riskInput = allRiskInput.slice(0, STEP4_ENGINE_LIMIT);
  if (!riskInput.length) {
    return {
      allowedKeys: new Set<string>(),
      checkedKeys: new Set<string>(),
      riskInputCount: 0,
      riskCoverageTruncated: false,
      step4RemovedCount: 0,
      reusedRiskCount: 0,
      newlyCheckedRiskCount: 0,
      warnings: ["STEP4_NO_ELIGIBLE_EXPERIMENT_CANDIDATE"],
    };
  }

  const missingRows = riskInput.filter((row) => !input.riskCache.has(candidateKey(row)));
  const warnings: string[] = [];
  if (missingRows.length) {
    const filtered = await filterKeywordElonProhibitedKeywords({
      identity: input.identity,
      candidates: missingRows,
      customBlockedTerms: input.customBlockedTerms,
    });
    warnings.push(...filtered.warnings);
    for (const decision of filtered.decisions) {
      input.riskCache.set(decision.searchKey, { allowed: !decision.blocked });
    }
  }

  const checkedKeys = new Set(riskInput.map(candidateKey));
  const allowedKeys = new Set(
    riskInput
      .map(candidateKey)
      .filter((key) => input.riskCache.get(key)?.allowed === true),
  );
  const step4RemovedCount = riskInput.filter(
    (row) => input.riskCache.get(candidateKey(row))?.allowed === false,
  ).length;
  if (allRiskInput.length > riskInput.length) {
    warnings.push(`STEP4_EXPERIMENT_COVERAGE_TRUNCATED:${allRiskInput.length}->${riskInput.length}`);
  }

  return {
    allowedKeys,
    checkedKeys,
    riskInputCount: riskInput.length,
    riskCoverageTruncated: allRiskInput.length > STEP4_ENGINE_LIMIT,
    step4RemovedCount,
    reusedRiskCount: riskInput.length - missingRows.length,
    newlyCheckedRiskCount: missingRows.length,
    warnings,
  };
}

export async function runKeywordElonThresholdExperiment(input: {
  source: KeywordElonSourceDraft;
  identity: KeywordElonIdentity;
  config: KeywordElonThresholdExperimentConfig;
  signal?: AbortSignal;
}) {
  const runStartedAt = Date.now();
  const startedAt = new Date().toISOString();
  const timings: Record<string, number> = {};
  const scoreCache = new Map<string, KeywordElonCandidate>();
  const riskCache = new Map<string, RiskCacheEntry>();

  assertNotAborted(input.signal);
  experimentLog("base-discovery-start", { product: input.identity.coreProduct });
  const discoveryStartedAt = Date.now();
  const rawBaseDiscovery = await discoverKeywordElonCandidatesResilient(
    input.source,
    input.identity,
  );
  const baseDiscovery = limitDiscoveryCandidates(
    rawBaseDiscovery,
    EXPERIMENT_BASE_CANDIDATE_LIMIT,
  );
  timings.baseDiscoverySeconds = elapsedSeconds(discoveryStartedAt);
  experimentLog("base-discovery-complete", {
    rawCandidates: rawBaseDiscovery.candidates.length,
    boundedCandidates: baseDiscovery.candidates.length,
    measuredSearch: baseDiscovery.searchAdStats.length,
    seconds: timings.baseDiscoverySeconds,
  });

  assertNotAborted(input.signal);
  const baseScoringStartedAt = Date.now();
  experimentLog("base-scoring-start", { candidates: baseDiscovery.candidates.length });
  const baseScored = await scoreDiscoveryWithCache({
    source: input.source,
    identity: input.identity,
    discovery: baseDiscovery,
    scoreCache,
    signal: input.signal,
  });
  timings.baseScoringSeconds = elapsedSeconds(baseScoringStartedAt);
  const baseSafeCount = baseScored.candidates.filter((row) => row.safetyPass).length;
  if (baseScored.scoringCoverage < EXPERIMENT_MIN_SCORING_COVERAGE) {
    throw new Error(
      `EXPERIMENT_INVALID_BASE_SCORING_COVERAGE:${(baseScored.scoringCoverage * 100).toFixed(1)}%`,
    );
  }
  if (baseSafeCount === 0) {
    throw new Error("EXPERIMENT_INVALID_ZERO_SAFE_BASE_CANDIDATES");
  }
  experimentLog("base-scoring-complete", {
    candidates: baseScored.candidates.length,
    safeCount: baseSafeCount,
    scoringCoverage: baseScored.scoringCoverage,
    cacheSize: scoreCache.size,
    seconds: timings.baseScoringSeconds,
  });

  const branchStartedAt = Date.now();
  const effectiveBranchConcurrency = 1;
  const branches = await mapWithConcurrency(
    input.config.step2Cutoffs,
    effectiveBranchConcurrency,
    (step2Cutoff) => runStep3Branch({
      source: input.source,
      identity: input.identity,
      baseDiscovery,
      baseCandidates: baseScored.candidates,
      scoreCache,
      step2Cutoff,
      rounds: input.config.step3Rounds,
      signal: input.signal,
    }),
  );
  timings.step3BranchesSeconds = elapsedSeconds(branchStartedAt);

  const broadThresholds: KeywordElonSelectionThresholds = {
    demandQuality: Math.min(...input.config.demandQualityThresholds),
    accuracyRelevance: Math.min(...input.config.accuracyRelevanceThresholds),
  };

  const riskStartedAt = Date.now();
  const branchReports = [];
  for (const branch of branches) {
    assertNotAborted(input.signal);
    experimentLog("risk-filter-start", {
      cutoff: branch.step2Cutoff,
      candidates: branch.candidates.length,
      cacheSize: riskCache.size,
    });
    const risk = await riskFilterBranch({
      branch,
      identity: input.identity,
      broadThresholds,
      customBlockedTerms: input.config.customBlockedTerms,
      riskCache,
      signal: input.signal,
    });
    const combinations = [];
    for (const demandQuality of input.config.demandQualityThresholds) {
      for (const accuracyRelevance of input.config.accuracyRelevanceThresholds) {
        combinations.push(summarizeCombination({
          branch,
          thresholds: { demandQuality, accuracyRelevance },
          allowedKeys: risk.allowedKeys,
          checkedKeys: risk.checkedKeys,
        }));
      }
    }
    branchReports.push({
      step2Cutoff: branch.step2Cutoff,
      basePassingCount: branch.basePassingCount,
      finalCandidateCount: branch.candidates.length,
      finalPassingCountAtStep2Cutoff: passingRows(
        branch.candidates,
        branch.step2Cutoff,
      ).length,
      rounds: branch.rounds,
      riskInputCount: risk.riskInputCount,
      riskCoverageTruncated: risk.riskCoverageTruncated,
      step4RemovedCountInBroadPool: risk.step4RemovedCount,
      newlyCheckedRiskCount: risk.newlyCheckedRiskCount,
      reusedRiskCount: risk.reusedRiskCount,
      warnings: [...new Set([...branch.warnings, ...risk.warnings])].slice(0, 60),
      combinations,
    });
    experimentLog("risk-filter-complete", {
      cutoff: branch.step2Cutoff,
      riskInputCount: risk.riskInputCount,
      removed: risk.step4RemovedCount,
      newlyChecked: risk.newlyCheckedRiskCount,
      reused: risk.reusedRiskCount,
    });
  }
  timings.step4AndSummariesSeconds = elapsedSeconds(riskStartedAt);

  const nonEmptyCombinationCount = branchReports.reduce(
    (sum, branch) => sum + branch.combinations.filter(
      (combination) => combination.step4AllowedCoreCount > 0,
    ).length,
    0,
  );
  if (nonEmptyCombinationCount === 0) {
    throw new Error("EXPERIMENT_INVALID_NO_NONEMPTY_FINAL_COMBINATION");
  }

  timings.totalSeconds = elapsedSeconds(runStartedAt);
  experimentLog("experiment-complete", {
    product: input.identity.coreProduct,
    nonEmptyCombinationCount,
    scoreCacheSize: scoreCache.size,
    riskCacheSize: riskCache.size,
    seconds: timings.totalSeconds,
  });

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    engine: "keyword-elon-threshold-experiment-v2",
    valid: true,
    validity: {
      baseSafeCount,
      baseScoringCoverage: baseScored.scoringCoverage,
      nonEmptyCombinationCount,
      minimumScoringCoverage: EXPERIMENT_MIN_SCORING_COVERAGE,
    },
    base: {
      rawCandidateCount: rawBaseDiscovery.candidates.length,
      candidateCount: baseScored.candidates.length,
      safeCount: baseSafeCount,
      measuredSearchCount: baseScored.candidates.filter(
        (row) => row.totalSearch !== null,
      ).length,
      marketRecallVersion: baseDiscovery.marketRecallVersion ?? "",
      apiHubDocumentCount: baseDiscovery.apiHubDocumentCount ?? 0,
      scoringCoverage: baseScored.scoringCoverage,
      scoringChunkCount: baseScored.scoringChunkCount,
      scoringWarnings: baseScored.scoringWarnings,
    },
    config: {
      ...input.config,
      effectiveBranchConcurrency,
      experimentBaseCandidateLimit: EXPERIMENT_BASE_CANDIDATE_LIMIT,
      experimentStep3CandidateLimit: EXPERIMENT_STEP3_CANDIDATE_LIMIT,
    },
    broadThresholds,
    cache: {
      semanticScoreCount: scoreCache.size,
      riskDecisionCount: riskCache.size,
    },
    timings,
    branchReports,
  };
}

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

const STEP3_SEED_LIMIT = 8;
const STEP5_OBSERVED_LIMIT = 30;
const STEP4_ENGINE_LIMIT = 120;

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

function candidateKey(row: KeywordElonCandidate) {
  return compactKeywordElonKey(row.searchKeyword || row.searchKey || row.keyword);
}

function candidateLabel(row: KeywordElonCandidate) {
  return row.searchKeyword || row.searchKey || row.keyword;
}

function passingRows(candidates: KeywordElonCandidate[], cutoff: number) {
  return [...candidates]
    .filter((row) => row.safetyPass && row.qualityScore >= cutoff)
    .sort((a, b) => b.qualityScore - a.qualityScore || (b.totalSearch ?? -1) - (a.totalSearch ?? -1));
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
      .sort((a, b) => b.relevance - a.relevance || b.shoppingIntent - a.shoppingIntent || b.specificity - a.specificity)
      .slice(0, 12)
      .map(candidateKey),
  );
  const topKeys = new Set([...demandTopKeys, ...accuracyTopKeys]);
  const eligible = safe
    .filter((row) => !coreKeys.has(candidateKey(row)))
    .filter((row) => row.relevance >= KEYWORD_ELON_V2_RELEVANCE_GATE && row.shoppingIntent >= KEYWORD_ELON_V2_SHOPPING_INTENT_GATE);
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
  step2Cutoff: number;
  rounds: number;
}): Promise<BranchResult> {
  let discovery = input.baseDiscovery;
  let candidates = input.baseCandidates;
  const rounds: BranchRound[] = [];
  const warnings: string[] = [];
  const basePassingCount = passingRows(candidates, input.step2Cutoff).length;

  for (let round = 1; round <= input.rounds; round += 1) {
    const seeds = seedRows(candidates, input.step2Cutoff);
    if (!seeds.length) {
      warnings.push(`STEP3_STOPPED_NO_SEED: cutoff ${input.step2Cutoff} · round ${round}`);
      break;
    }
    const previousKeys = new Set(candidates.map(candidateKey));
    const expanded = await expandKeywordElonFromPassing({
      identity: input.identity,
      seedKeywords: seeds,
      existingDiscovery: discovery,
      existingCandidates: candidates,
      round,
    });
    warnings.push(...expanded.warnings);

    let newPassingCount = 0;
    if (expanded.newCandidateCount > 0 && expanded.discovery.candidates.length > 0) {
      const scored = await scoreKeywordElonCandidatesBatched({
        source: input.source,
        identity: input.identity,
        discovery: expanded.discovery,
      });
      warnings.push(...scored.scoringWarnings);
      newPassingCount = scored.candidates.filter(
        (row) => row.safetyPass
          && row.qualityScore >= input.step2Cutoff
          && !previousKeys.has(candidateKey(row)),
      ).length;
      discovery = mergeKeywordElonDiscovery(discovery, expanded.discovery);
      candidates = mergeKeywordElonCandidates(candidates, scored.candidates);
    }

    rounds.push({
      round,
      seedKeywords: seeds,
      newCandidateCount: expanded.newCandidateCount,
      newPassingCount,
      cumulativeCandidateCount: candidates.length,
      cumulativePassingCount: passingRows(candidates, input.step2Cutoff).length,
    });
  }

  return {
    step2Cutoff: input.step2Cutoff,
    basePassingCount,
    discovery,
    candidates,
    rounds,
    warnings: [...new Set(warnings)].slice(0, 40),
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
) {
  const result = new Array<R>(values.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      result[index] = await worker(values[index]);
    }
  });
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
  const diversityRows = diversityCandidates.filter((row) => input.allowedKeys.has(candidateKey(row)) && !coreKeys.has(candidateKey(row)));
  const measuredSearch = coreRows.map((row) => row.totalSearch).filter((value): value is number => value !== null);
  const uncoveredCoreCount = union.filter((row) => !input.checkedKeys.has(candidateKey(row))).length;
  const uncoveredDiversityCount = diversityCandidates.filter((row) => !input.checkedKeys.has(candidateKey(row))).length;

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
    step5ObservedKeywords: diversityRows.map((row) => keywordResult(row, ["step5_observed"])),
  };
}

async function riskFilterBranch(input: {
  branch: BranchResult;
  identity: KeywordElonIdentity;
  broadThresholds: KeywordElonSelectionThresholds;
  customBlockedTerms: string[];
}) {
  const broadUnion = selectKeywordElonStep4Union(input.branch.candidates, input.broadThresholds);
  const allDiversity = buildObservedDiversityCandidates(input.branch.candidates, new Set<string>());
  const riskInput = uniqueRowsPreserveOrder([...broadUnion, ...allDiversity]);
  if (!riskInput.length) {
    return {
      allowedKeys: new Set<string>(),
      checkedKeys: new Set<string>(),
      riskInputCount: 0,
      riskCoverageTruncated: false,
      step4RemovedCount: 0,
      warnings: ["STEP4_NO_ELIGIBLE_EXPERIMENT_CANDIDATE"],
    };
  }
  const filtered = await filterKeywordElonProhibitedKeywords({
    identity: input.identity,
    candidates: riskInput,
    customBlockedTerms: input.customBlockedTerms,
  });
  return {
    allowedKeys: new Set(filtered.allowedKeys),
    checkedKeys: new Set(filtered.decisions.map((decision) => decision.searchKey)),
    riskInputCount: riskInput.length,
    riskCoverageTruncated: riskInput.length > STEP4_ENGINE_LIMIT,
    step4RemovedCount: filtered.removedCount,
    warnings: filtered.warnings,
  };
}

export async function runKeywordElonThresholdExperiment(input: {
  source: KeywordElonSourceDraft;
  identity: KeywordElonIdentity;
  config: KeywordElonThresholdExperimentConfig;
}) {
  const startedAt = new Date().toISOString();
  const baseDiscovery = await discoverKeywordElonCandidatesResilient(input.source, input.identity);
  const baseScored = await scoreKeywordElonCandidatesBatched({
    source: input.source,
    identity: input.identity,
    discovery: baseDiscovery,
  });

  const branches = await mapWithConcurrency(
    input.config.step2Cutoffs,
    input.config.branchConcurrency,
    (step2Cutoff) => runStep3Branch({
      source: input.source,
      identity: input.identity,
      baseDiscovery,
      baseCandidates: baseScored.candidates,
      step2Cutoff,
      rounds: input.config.step3Rounds,
    }),
  );

  const broadThresholds: KeywordElonSelectionThresholds = {
    demandQuality: Math.min(...input.config.demandQualityThresholds),
    accuracyRelevance: Math.min(...input.config.accuracyRelevanceThresholds),
  };

  const branchReports = [];
  for (const branch of branches) {
    const risk = await riskFilterBranch({
      branch,
      identity: input.identity,
      broadThresholds,
      customBlockedTerms: input.config.customBlockedTerms,
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
      finalPassingCountAtStep2Cutoff: passingRows(branch.candidates, branch.step2Cutoff).length,
      rounds: branch.rounds,
      riskInputCount: risk.riskInputCount,
      riskCoverageTruncated: risk.riskCoverageTruncated,
      step4RemovedCountInBroadPool: risk.step4RemovedCount,
      warnings: [...new Set([...branch.warnings, ...risk.warnings])].slice(0, 50),
      combinations,
    });
  }

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    engine: "keyword-elon-threshold-experiment-v1",
    base: {
      candidateCount: baseScored.candidates.length,
      safeCount: baseScored.candidates.filter((row) => row.safetyPass).length,
      measuredSearchCount: baseScored.candidates.filter((row) => row.totalSearch !== null).length,
      marketRecallVersion: baseDiscovery.marketRecallVersion ?? "",
      apiHubDocumentCount: baseDiscovery.apiHubDocumentCount ?? 0,
      scoringWarnings: baseScored.scoringWarnings,
    },
    config: input.config,
    broadThresholds,
    branchReports,
  };
}

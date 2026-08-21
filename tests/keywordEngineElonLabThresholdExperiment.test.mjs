import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile("src/app/api/keyword-engine-elon-lab/experiment/route.ts", "utf8");
const runner = await readFile("src/lib/keywordEngineElonLabThresholdExperiment.ts", "utf8");
const fixtures = await readFile("src/lib/keywordEngineElonLabExperimentFixtures.ts", "utf8");
const scoring = await readFile("src/lib/keywordEngineElonLabV2Scoring.ts", "utf8");
const step3 = await readFile("src/lib/keywordEngineElonLabV2Step3.ts", "utf8");
const workflow = await readFile(".github/workflows/keyword-engine-elon-lab-ci.yml", "utf8");
const experimentWorkflow = await readFile(".github/workflows/keyword-threshold-experiment-run.yml", "utf8");
const request = await readFile("experiments/keyword-threshold-run-request.json", "utf8");

test("threshold experiment is preview/local only and requires explicit confirmation", () => {
  assert.match(route, /VERCEL_ENV === "preview"/);
  assert.match(route, /KEYWORD_THRESHOLD_EXPERIMENT_LOCAL_RUN === "1"/);
  assert.match(route, /RUN_THRESHOLD_EXPERIMENT/);
  assert.match(route, /EXPERIMENT_CONFIRMATION_REQUIRED/);
  assert.match(route, /mode=run/);
  assert.match(route, /EXPERIMENT_RUN_FAILED/);
  assert.match(route, /signal: request\.signal/);
});

test("threshold defaults survive omitted values and serialize STEP3 branches", () => {
  assert.match(route, /if \(!raw\?\.trim\(\)\) return fallback/);
  assert.match(route, /\.map\(\(value\) => value\.trim\(\)\)\s*\.filter\(Boolean\)\s*\.map\(Number\)/s);
  assert.match(route, /step3Rounds: integerParam\(searchParams\.get\("rounds"\), 3, 1, 3\)/);
  assert.match(route, /branchConcurrency: integerParam\(searchParams\.get\("concurrency"\), 1, 1, 1\)/);
  assert.match(request, /"concurrency": 1/);
});

test("experiment reuses STEP2 discovery and cached semantic scores across cutoff branches", () => {
  assert.match(runner, /const rawBaseDiscovery = await discoverKeywordElonCandidatesResilient/);
  assert.match(runner, /limitDiscoveryCandidates/);
  assert.match(runner, /EXPERIMENT_BASE_CANDIDATE_LIMIT = 240/);
  assert.match(runner, /const scoreCache = new Map<string, KeywordElonCandidate>/);
  assert.match(runner, /scoreDiscoveryWithCache/);
  assert.match(runner, /effectiveBranchConcurrency = 1/);
  assert.match(runner, /reusedScoreCount/);
  assert.match(runner, /semanticScoreCount: scoreCache\.size/);
});

test("invalid or incomplete scoring cannot be reported as a successful experiment", () => {
  assert.match(scoring, /SCORE_CHUNK_SIZE = EXPERIMENT_MODE \? 8 : 12/);
  assert.match(scoring, /SCORE_CONCURRENCY = EXPERIMENT_MODE \? 3 : 1/);
  assert.match(scoring, /SCORE_MAX_OUTPUT_TOKENS = EXPERIMENT_MODE \? 6_000 : 2_600/);
  assert.match(scoring, /scoreChunkResilient/);
  assert.match(scoring, /AI_SCORE_INSUFFICIENT_COVERAGE/);
  assert.match(scoring, /scoringCoverage/);
  assert.match(runner, /EXPERIMENT_INVALID_ZERO_SAFE_BASE_CANDIDATES/);
  assert.match(runner, /EXPERIMENT_INVALID_NO_NONEMPTY_FINAL_COMBINATION/);
  assert.match(runner, /engine: "keyword-elon-threshold-experiment-v2"/);
  assert.match(runner, /valid: true/);
});

test("STEP3 expansion is bounded only in experiment mode", () => {
  assert.match(step3, /EXPERIMENT_MODE = process\.env\.KEYWORD_THRESHOLD_EXPERIMENT_LOCAL_RUN === "1"/);
  assert.match(step3, /STEP3_CANDIDATE_LIMIT = EXPERIMENT_MODE \? 140 : 300/);
  assert.match(step3, /STEP3_API_HUB_TERM_LIMIT = EXPERIMENT_MODE \? 60 : 90/);
  assert.match(step3, /STEP3_SEARCHAD_GLOBAL_LIMIT = EXPERIMENT_MODE \? 120 : 220/);
});

test("experiment evaluates demand and accuracy independently then applies STEP4 and STEP5", () => {
  assert.match(runner, /selectKeywordElonDemandCandidates/);
  assert.match(runner, /selectKeywordElonAccuracyCandidates/);
  assert.match(runner, /selectKeywordElonStep4Union/);
  assert.match(runner, /filterKeywordElonProhibitedKeywords/);
  assert.match(runner, /const riskCache = new Map<string, RiskCacheEntry>/);
  assert.match(runner, /step5ObservedKeywords/);
  assert.match(runner, /STEP5_OBSERVED_LIMIT = 30/);
});

test("shared STEP4 risk pool covers broad core plus diversity candidates", () => {
  assert.match(runner, /const broadUnionKeys = new Set\(broadUnion\.map\(candidateKey\)\)/);
  assert.match(runner, /buildObservedDiversityCandidates\(\s*input\.branch\.candidates,\s*broadUnionKeys/s);
  assert.match(runner, /uniqueRowsPreserveOrder\(\[\.\.\.broadUnion, \.\.\.allDiversity\]\)/);
  assert.match(runner, /newlyCheckedRiskCount/);
  assert.match(runner, /reusedRiskCount/);
});

test("first fixed fixture preserves approved STEP1 identity and derives its source", () => {
  assert.match(fixtures, /nose-tape-step1-v1/);
  assert.match(fixtures, /코 성형 테이프\(코 모양 보정 패치\)/);
  assert.match(fixtures, /confidence: 0\.88/);
  assert.match(fixtures, /sourceMode: "step1-derived"/);
  assert.match(fixtures, /EXPERIMENT_SOURCE_DERIVED_FROM_APPROVED_STEP1/);
  assert.match(fixtures, /chineseTitle: noseTapeIdentity\.koreanProductIdentity/);
  assert.match(fixtures, /optionText: \[/);
  assert.match(fixtures, /keywordElonExperimentFixtureSourceReady/);
  assert.match(route, /sourceMode: fixture\.sourceMode/);
  assert.match(route, /EXPERIMENT_SOURCE_INCOMPLETE/);
});

test("dedicated runner cancels stale runs and isolates one sample per job", () => {
  assert.match(experimentWorkflow, /cancel-in-progress: true/);
  assert.match(experimentWorkflow, /max-parallel: 2/);
  assert.match(experimentWorkflow, /name: run-experiment-\$\{\{ matrix\.sample \}\}/);
  assert.match(experimentWorkflow, /EXPERIMENT_SAMPLE: \$\{\{ matrix\.sample \}\}/);
  assert.match(experimentWorkflow, /--max-time 3000/);
  assert.match(experimentWorkflow, /result\.get\("valid"\) is not True/);
  assert.doesNotMatch(experimentWorkflow, /EXPERIMENT_SAMPLES_JSON/);
});

test("dedicated keyword lab CI includes all experiment reliability files", () => {
  assert.match(workflow, /experiment\/route\.ts/);
  assert.match(workflow, /keywordEngineElonLabThresholdExperiment\.ts/);
  assert.match(workflow, /keywordEngineElonLabExperimentFixtures\.ts/);
  assert.match(workflow, /keywordEngineElonLabV2Scoring\.ts/);
  assert.match(workflow, /keywordEngineElonLabV2SearchAd\.ts/);
  assert.match(workflow, /keywordEngineElonLabV2Step3\.ts/);
  assert.match(workflow, /keywordEngineElonLabThresholdExperiment\.test\.mjs/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile("src/app/api/keyword-engine-elon-lab/experiment/route.ts", "utf8");
const runner = await readFile("src/lib/keywordEngineElonLabThresholdExperiment.ts", "utf8");
const fixtures = await readFile("src/lib/keywordEngineElonLabExperimentFixtures.ts", "utf8");
const workflow = await readFile(".github/workflows/keyword-engine-elon-lab-ci.yml", "utf8");

test("threshold experiment is preview-only and requires explicit confirmation", () => {
  assert.match(route, /VERCEL_ENV === "preview"/);
  assert.match(route, /RUN_THRESHOLD_EXPERIMENT/);
  assert.match(route, /EXPERIMENT_CONFIRMATION_REQUIRED/);
  assert.match(route, /mode=run/);
});

test("experiment reuses STEP2 discovery and only branches STEP3 by cutoff", () => {
  assert.match(runner, /const baseDiscovery = await discoverKeywordElonCandidatesResilient/);
  assert.match(runner, /const baseScored = await scoreKeywordElonCandidatesBatched/);
  assert.match(runner, /input\.config\.step2Cutoffs/);
  assert.match(runner, /runStep3Branch/);
  assert.match(runner, /branchConcurrency/);
});

test("experiment evaluates demand and accuracy thresholds independently then applies STEP4 and STEP5", () => {
  assert.match(runner, /selectKeywordElonDemandCandidates/);
  assert.match(runner, /selectKeywordElonAccuracyCandidates/);
  assert.match(runner, /selectKeywordElonStep4Union/);
  assert.match(runner, /filterKeywordElonProhibitedKeywords/);
  assert.match(runner, /step5ObservedKeywords/);
  assert.match(runner, /STEP5_OBSERVED_LIMIT = 30/);
});

test("first fixed fixture preserves approved STEP1 identity and can derive experiment source without raw Chinese text", () => {
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
  assert.doesNotMatch(route, /중국 상품명 원문/);
  assert.doesNotMatch(route, /중국 옵션 원문/);
});

test("dedicated keyword lab CI includes the experiment route, runner and contract test", () => {
  assert.match(workflow, /experiment\/route\.ts/);
  assert.match(workflow, /keywordEngineElonLabThresholdExperiment\.ts/);
  assert.match(workflow, /keywordEngineElonLabExperimentFixtures\.ts/);
  assert.match(workflow, /keywordEngineElonLabThresholdExperiment\.test\.mjs/);
});

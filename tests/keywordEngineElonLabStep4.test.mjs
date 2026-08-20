import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile("src/app/api/keyword-engine-elon-lab/route.ts", "utf8");
const layout = await readFile("src/app/keyword-engine-elon-lab/layout.tsx", "utf8");
const component = await readFile("src/app/keyword-engine-elon-lab/KeywordElonStep4DualFilter.tsx", "utf8");
const demandSummary = await readFile("src/app/keyword-engine-elon-lab/KeywordElonDemandSummary.tsx", "utf8");
const selection = await readFile("src/lib/keywordEngineElonLabV2Selection.ts", "utf8");
const filter = await readFile("src/lib/keywordEngineElonLabV2Step4.ts", "utf8");
const workflow = await readFile(".github/workflows/keyword-engine-elon-lab-ci.yml", "utf8");

test("STEP 4 is mounted after demand summary and uses dual threshold component", () => {
  assert.match(layout, /KeywordElonDemandSummary/);
  assert.match(layout, /KeywordElonStep4DualFilter/);
  assert.ok(layout.indexOf("<KeywordElonDemandSummary />") < layout.indexOf("<KeywordElonStep4DualFilter />"));
  assert.doesNotMatch(layout, /<KeywordElonStep4Filter \/>/);
  assert.match(component, /Number\(session\?\.step3\?\.round\) >= 3/);
});

test("demand and accuracy thresholds are separately editable and persisted", () => {
  assert.match(selection, /KEYWORD_ELON_DEFAULT_DEMAND_QUALITY = 60/);
  assert.match(selection, /KEYWORD_ELON_DEFAULT_ACCURACY_RELEVANCE = 90/);
  assert.match(selection, /keywordEngineElonLab\.selectionThresholds\.v1/);
  assert.match(demandSummary, /품질점수 ≥/);
  assert.match(demandSummary, /관련성 ≥/);
  assert.match(demandSummary, /updateThreshold\("demandQuality"/);
  assert.match(demandSummary, /updateThreshold\("accuracyRelevance"/);
  assert.match(demandSummary, /writeKeywordElonSelectionThresholds/);
});

test("STEP 4 input is the canonical union of demand and accuracy qualified candidates", () => {
  assert.match(selection, /selectKeywordElonDemandCandidates/);
  assert.match(selection, /row\.qualityScore >= thresholds\.demandQuality/);
  assert.match(selection, /selectKeywordElonAccuracyCandidates/);
  assert.match(selection, /row\.relevance >= thresholds\.accuracyRelevance/);
  assert.match(selection, /row\.safetyPass/);
  assert.match(selection, /row\.titleEligible/);
  assert.match(selection, /selectKeywordElonStep4Union/);
  assert.match(selection, /const map = new Map/);
  assert.match(component, /selectKeywordElonStep4Union/);
  assert.match(component, /candidates: selectedCandidates/);
  assert.match(component, /cutoff: 0/);
  assert.match(route, /Number\.isFinite\(rawCutoff\) \? rawCutoff : 70/);
  assert.doesNotMatch(route, /Number\(body\.cutoff\) \|\| 70/);
});

test("STEP 4 route exposes prohibited-keyword action while KIPRIS is paused", () => {
  assert.match(route, /filterKeywordElonProhibitedKeywords/);
  assert.match(route, /step4FilterAvailable: true/);
  assert.match(route, /kiprisConfigured: false/);
  assert.match(route, /action === "filter_prohibited_keywords"/);
  assert.match(route, /customBlockedTerms: textArray\(body\.customBlockedTerms, 120\)/);
});

test("STEP 4 risk filter retains deterministic and AI-assisted blocked categories", () => {
  for (const category of ["medical_device", "pregnancy", "baby", "adult", "custom"]) {
    assert.match(filter, new RegExp(`\\"${category}\\"`));
  }
  for (const marker of ["의료기기", "임산부", "신생아", "성인용품"]) {
    assert.match(filter, new RegExp(marker));
  }
  assert.match(filter, /BUILTIN_RISK_TERMS/);
  assert.match(filter, /confidence >= 0\.82/);
  assert.match(filter, /uniqueKeywordElonCanonical\(input\.customBlockedTerms, 120\)/);
});

test("KIPRIS remains explicitly paused", () => {
  assert.match(filter, /export function keywordElonKiprisConfigured\(\) \{\s*return false;/);
  assert.match(filter, /kiprisConfigured: false/);
  assert.match(component, /KIPRIS 보류/);
});

test("user blocked keywords persist and dual-filtered candidates regenerate the title", () => {
  assert.match(component, /keywordEngineElonLab\.step4\.customBlockedTerms\.v1/);
  assert.match(component, /saveCustomBlockedTerms/);
  assert.match(component, /action: "filter_prohibited_keywords"/);
  assert.match(component, /const allowedSet = new Set\(filtered\.result\.allowedKeys\)/);
  assert.match(component, /action: "generate_title"/);
  assert.match(component, /currentFingerprint/);
  assert.match(component, /자동 재계산/);
});

test("dual threshold STEP 4 files are included in dedicated CI", () => {
  assert.match(workflow, /KeywordElonStep4DualFilter\.tsx/);
  assert.match(workflow, /keywordEngineElonLabV2Selection\.ts/);
  assert.match(workflow, /keywordEngineElonLabStep4\.test\.mjs/);
});

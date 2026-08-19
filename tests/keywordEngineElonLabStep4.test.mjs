import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile("src/app/api/keyword-engine-elon-lab/route.ts", "utf8");
const layout = await readFile("src/app/keyword-engine-elon-lab/layout.tsx", "utf8");
const component = await readFile("src/app/keyword-engine-elon-lab/KeywordElonStep4Filter.tsx", "utf8");
const filter = await readFile("src/lib/keywordEngineElonLabV2Step4.ts", "utf8");
const workflow = await readFile(".github/workflows/keyword-engine-elon-lab-ci.yml", "utf8");

test("STEP 4 is mounted only after STEP 3 final material summary", () => {
  assert.match(layout, /KeywordElonDemandSummary/);
  assert.match(layout, /KeywordElonStep4Filter/);
  assert.ok(layout.indexOf("<KeywordElonDemandSummary />") < layout.indexOf("<KeywordElonStep4Filter />"));
  assert.match(component, /session\?\.step3\?\.status === "done"/);
  assert.match(component, /Number\(session\?\.step3\?\.round\) >= 1/);
  assert.match(component, /row\.safetyPass && row\.qualityScore >=/);
});

test("STEP 4 route exposes readiness and prohibited-keyword action", () => {
  assert.match(route, /filterKeywordElonProhibitedKeywords/);
  assert.match(route, /keywordElonKiprisConfigured/);
  assert.match(route, /step4FilterAvailable: true/);
  assert.match(route, /kiprisConfigured: keywordElonKiprisConfigured\(\)/);
  assert.match(route, /action === "filter_prohibited_keywords"/);
  assert.match(route, /customBlockedTerms: textArray\(body\.customBlockedTerms, 120\)/);
});

test("STEP 4 has deterministic and AI-assisted risk categories", () => {
  for (const category of ["medical_device", "pregnancy", "baby", "adult", "custom", "trademark"]) {
    assert.match(filter, new RegExp(`\\"${category}\\"`));
  }
  for (const marker of ["의료기기", "임산부", "신생아", "성인용품"]) {
    assert.match(filter, new RegExp(marker));
  }
  assert.match(filter, /BUILTIN_RISK_TERMS/);
  assert.match(filter, /confidence >= 0\.82/);
  assert.match(filter, /uniqueKeywordElonCanonical\(input\.customBlockedTerms, 120\)/);
  assert.match(filter, /decision\.searchKey\.includes\(term\)/);
});

test("STEP 4 semantic review processes every candidate in bounded batches", () => {
  assert.match(filter, /const AI_RISK_BATCH_SIZE = 60/);
  assert.match(filter, /index < keywords\.length; index \+= AI_RISK_BATCH_SIZE/);
  assert.match(filter, /keywords\.slice\(index, index \+ AI_RISK_BATCH_SIZE\)/);
  assert.match(filter, /MISSING_DECISIONS/);
  assert.match(filter, /입력된 모든 키워드에 대해 정확히 한 개의 decision/);
});

test("KIPRIS integration is optional, server-only, exact, and fail-open", () => {
  assert.match(filter, /KIPRISPLUS_ACCESS_KEY/);
  assert.match(filter, /KIPRIS_ACCESS_KEY/);
  assert.match(filter, /KIPRISPLUS_TRADEMARK_ENDPOINT/);
  assert.match(filter, /trademarkInfoSearchService\/getWordSearch/);
  assert.match(filter, /searchString/);
  assert.match(filter, /accessKey/);
  assert.match(filter, /compactKeywordElonKey\(trademarkName\) === keywordKey/);
  assert.match(filter, /clearlyInactiveTrademark/);
  assert.match(filter, /KIPRIS_NOT_CONFIGURED/);
  assert.match(filter, /KIPRIS_CHECK_LIMIT/);
  assert.doesNotMatch(component, /KIPRISPLUS_ACCESS_KEY|KIPRIS_ACCESS_KEY/);
});

test("user blocked keywords persist and filtered candidates regenerate the title", () => {
  assert.match(component, /keywordEngineElonLab\.step4\.customBlockedTerms\.v1/);
  assert.match(component, /saveCustomBlockedTerms/);
  assert.match(component, /action: "filter_prohibited_keywords"/);
  assert.match(component, /const allowedSet = new Set\(filtered\.result\.allowedKeys\)/);
  assert.match(component, /const filteredCandidates = inputCandidates\.filter/);
  assert.match(component, /action: "generate_title"/);
  assert.match(component, /candidates: filteredCandidates/);
  assert.match(component, /inputFingerprint/);
  assert.match(component, /window\.location\.reload/);
});

test("STEP 4 files are included in dedicated CI", () => {
  assert.match(workflow, /KeywordElonStep4Filter\.tsx/);
  assert.match(workflow, /keywordEngineElonLabV2Step4\.ts/);
  assert.match(workflow, /keywordEngineElonLabStep4\.test\.mjs/);
});

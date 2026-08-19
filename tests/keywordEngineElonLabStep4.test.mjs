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

test("STEP 4 route exposes prohibited-keyword action while KIPRIS is paused", () => {
  assert.match(route, /filterKeywordElonProhibitedKeywords/);
  assert.match(route, /step4FilterAvailable: true/);
  assert.match(route, /kiprisConfigured: false/);
  assert.match(route, /oneClickToStep4Available: true/);
  assert.match(route, /action === "filter_prohibited_keywords"/);
  assert.match(route, /customBlockedTerms: textArray\(body\.customBlockedTerms, 120\)/);
  assert.doesNotMatch(route, /keywordElonKiprisConfigured/);
});

test("STEP 4 has deterministic and AI-assisted risk categories", () => {
  for (const category of ["medical_device", "pregnancy", "baby", "adult", "custom"]) {
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

test("KIPRIS is explicitly paused and never called in the current STEP 4", () => {
  assert.match(filter, /export function keywordElonKiprisConfigured\(\) \{\s*return false;/);
  assert.match(filter, /kiprisConfigured: false/);
  assert.match(filter, /kiprisCheckedCount: 0/);
  assert.match(filter, /kiprisMatchedCount: 0/);
  assert.doesNotMatch(filter, /KIPRISPLUS_ACCESS_KEY|KIPRIS_ACCESS_KEY|trademarkInfoSearchService\/getWordSearch|fetchKipris|checkKiprisTrademark/);
  assert.match(component, /KIPRIS 상표권 · 보류/);
  assert.match(component, /KIPRIS 상표권 API 연결은 이번 버전에서 보류하며 호출하지 않습니다/);
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

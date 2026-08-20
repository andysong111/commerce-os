import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const layout = await readFile("src/app/keyword-engine-elon-lab/layout.tsx", "utf8");
const component = await readFile("src/app/keyword-engine-elon-lab/KeywordElonDiversitySupplement.tsx", "utf8");
const workflow = await readFile(".github/workflows/keyword-engine-elon-lab-ci.yml", "utf8");

test("diversity supplement is mounted after STEP 4", () => {
  assert.match(layout, /KeywordElonDiversitySupplement/);
  assert.ok(layout.indexOf("<KeywordElonStep4Filter />") < layout.indexOf("<KeywordElonDiversitySupplement />"));
  assert.match(component, /DIVERSITY SUPPLEMENT · AFTER STEP 4/);
  assert.match(component, /다양성 보조 키워드/);
});

test("observed supplement prefers collected safe candidates outside the core and top rankings", () => {
  assert.match(component, /row\.safetyPass && row\.titleEligible/);
  assert.match(component, /row\.relevance >= 80 && row\.shoppingIntent >= 70/);
  assert.match(component, /!coreKeys\.has\(candidateKey\(row\)\)/);
  assert.match(component, /!topKeys\.has\(candidateKey\(row\)\)/);
  assert.match(component, /TOP 밖 실측/);
  assert.match(component, /커트라인 밖 실측/);
});

test("supplement candidates pass the same STEP 4 prohibited keyword filter", () => {
  assert.match(component, /action: "filter_prohibited_keywords"/);
  assert.match(component, /customBlockedTerms: readCustomBlockedTerms\(\)/);
  assert.match(component, /observedAllowedKeys: filtered\.result\.allowedKeys/);
});

test("extra market and AI discovery is opt-in and remains gated", () => {
  assert.match(component, /보조 키워드 더 찾기/);
  assert.match(component, /action: "discover_keywords"/);
  assert.match(component, /action: "score_keywords"/);
  assert.match(component, /existingKeys/);
  assert.match(component, /generatedAllowedKeys: filtered\.result\.allowedKeys/);
  assert.match(component, /현재 상품명 생성에는 자동으로 섞지 않습니다/);
});

test("diversity supplement is included in dedicated CI", () => {
  assert.match(workflow, /KeywordElonDiversitySupplement\.tsx/);
  assert.match(workflow, /keywordEngineElonLabDiversitySupplement\.test\.mjs/);
});

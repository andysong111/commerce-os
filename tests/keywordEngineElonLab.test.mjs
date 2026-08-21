import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile("src/app/keyword-engine-elon-lab/page.tsx", "utf8");
const route = await readFile("src/app/api/keyword-engine-elon-lab/route.ts", "utf8");
const domain = await readFile("src/lib/keywordEngineElonLabV2.ts", "utf8");
const browserImport = await readFile("src/lib/keywordEngineElonLabBrowserImport.ts", "utf8");
const moduleFile = await readFile("src/lib/keywordEngineElonLabModule.ts", "utf8");
const manifest = await readFile("public/keyword-lab-collector/manifest.json", "utf8");
const collector1688 = await readFile("public/keyword-lab-collector/content-1688.js", "utf8");
const layout = await readFile("src/app/keyword-engine-elon-lab/layout.tsx", "utf8");
const demandSummary = await readFile("src/app/keyword-engine-elon-lab/KeywordElonDemandSummary.tsx", "utf8");

test("Elon Lab starts from a 1688 URL and exposes only two execution steps", () => {
  assert.match(page, /1688 중국 상품 링크/);
  assert.match(page, /STEP 1/);
  assert.match(page, /STEP 2/);
  assert.match(page, /FINAL RESULT/);
  assert.doesNotMatch(page, /121073|121065|121059|121053|121050|121045/);
});

test("session survives refresh with browser storage", () => {
  assert.match(domain, /keywordEngineElonLab\.v2\.session/);
  assert.match(page, /localStorage\.getItem\(KEYWORD_ELON_V2_STORAGE_KEY\)/);
  assert.match(page, /localStorage\.setItem\(KEYWORD_ELON_V2_STORAGE_KEY/);
});

test("minimum ten is a target, not a maximum", () => {
  assert.match(domain, /KEYWORD_ELON_V2_MINIMUM_KEYWORDS = 10/);
  assert.match(domain, /KEYWORD_ELON_V2_DEFAULT_CUTOFF = 60/);
  assert.match(page, /최소 목표/);
  assert.match(page, /상한 없음/);
});

test("demand-first safety and weight policy remains intact", () => {
  assert.match(domain, /KEYWORD_ELON_V2_RELEVANCE_GATE = 80/);
  assert.match(domain, /KEYWORD_ELON_V2_SHOPPING_INTENT_GATE = 70/);
  assert.match(domain, /demandScore\*0\.55|demandScore \* 0\.55/);
  assert.match(domain, /input\.relevance\*0\.2|input\.relevance \* 0\.2/);
  assert.match(domain, /input\.shoppingIntent\*0\.1|input\.shoppingIntent \* 0\.1/);
  assert.match(domain, /competitionOpportunity\*0\.1|competitionOpportunity \* 0\.1/);
  assert.match(domain, /input\.specificity\*0\.05|input\.specificity \* 0\.05/);
  assert.match(domain, /safetyPass\?opportunityScore:0|safetyPass \? opportunityScore : 0/);
});

test("final result includes title and V6 evidence diagnostics", () => {
  assert.match(page, /추천 상품명/);
  assert.match(page, /현재 커트라인으로 상품명 다시 생성/);
  assert.match(page, /통과 키워드 · 점수 높은 순/);
  assert.match(layout, /KeywordElonDemandSummary/);
  assert.match(demandSummary, /MARKET RECALL V6/);
  assert.match(demandSummary, /Evidence Market Mine/);
  assert.match(demandSummary, /월검색량 TOP · canonical no-space/);
  assert.match(demandSummary, /상품 정확성 TOP/);
});

test("API exposes V6 pipeline actions", () => {
  for (const action of ["collect_source", "analyze_identity", "discover_keywords", "score_keywords", "enrich_demand", "generate_title"]) {
    assert.match(route, new RegExp(`action === \\"${action}\\"`));
  }
  assert.match(route, /version: 6/);
  assert.match(route, /marketRecall: "evidence-first"/);
  assert.match(route, /apiHubConfigured/);
  assert.doesNotMatch(route, /keywordEngineElonLabStore|keywordEngineElonLabShopling/);
});

test("Keyword Lab collector remains dedicated and independent from AI-Saurus", () => {
  assert.match(page, /Commerce OS Keyword Lab Collector/);
  assert.match(page, /전용 수집기 ZIP 다운로드/);
  assert.match(browserImport, /KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION = "0\.1\.1"/);
  assert.match(browserImport, /commerce_os_keyword_lab_collect/);
  assert.match(manifest, /Commerce OS Keyword Lab Collector/);
  assert.match(collector1688, /extractProductName/);
  assert.match(collector1688, /extractStructuredOptionGroups/);
  assert.doesNotMatch(page, /AI-Saurus|SaaS 방식 자동수집/);
});

test("module registry describes evidence-first Market Recall V6", () => {
  assert.match(moduleFile, /1688 중국 원본 링크/);
  assert.match(moduleFile, /지식iN·카페·블로그·웹문서/);
  assert.match(moduleFile, /Evidence Market Mine/);
  assert.match(moduleFile, /Search Trend/);
  assert.match(moduleFile, /\/keyword-engine-elon-lab/);
});

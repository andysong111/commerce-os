import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile("src/app/keyword-engine-elon-lab/page.tsx", "utf8");
const layout = await readFile("src/app/keyword-engine-elon-lab/layout.tsx", "utf8");
const auto = await readFile("src/app/keyword-engine-elon-lab/KeywordElonAutoRunToStep4.tsx", "utf8");
const collapsible = await readFile("src/app/keyword-engine-elon-lab/KeywordElonCollapsibleSection.tsx", "utf8");
const core = await readFile("src/lib/keywordEngineElonLabV2.ts", "utf8");
const merge = await readFile("src/lib/keywordEngineElonLabV2Merge.ts", "utf8");
const workflow = await readFile(".github/workflows/keyword-engine-elon-lab-ci.yml", "utf8");

test("STEP 2 is a persisted cumulative round with the locked 60-point standard", () => {
  assert.match(core, /KEYWORD_ELON_V2_DEFAULT_CUTOFF = 60/);
  assert.match(core, /stage2Round: number/);
  assert.match(core, /stage2Round: 0/);
  assert.match(page, /const round = \(session\.stage2Round \?\? 0\) \+ 1/);
  assert.match(page, /const baseDiscovery = session\.discovery/);
  assert.match(page, /const baseCandidates = session\.scoredCandidates/);
  assert.match(page, /mergeKeywordElonCandidates\(baseCandidates, scored\.candidates\)/);
  assert.match(page, /mergeKeywordElonDiscovery\(baseDiscovery, discovered\.discovery\)/);
  assert.match(page, /stage2Round: round/);
  assert.match(page, /STEP 2 · 추가발굴 round/);
  assert.match(page, /완료 round/);
  assert.match(page, /누적 후보/);
  assert.match(page, /기존 결과 누적/);
  assert.match(page, /표준 품질 커트라인 60점 · 고정/);
  assert.doesNotMatch(page, /changeCutoff/);
});

test("shared merge helpers canonicalize and preserve accumulated results", () => {
  assert.match(merge, /export function mergeKeywordElonDiscovery/);
  assert.match(merge, /export function mergeKeywordElonCandidates/);
  assert.match(merge, /uniqueKeywordElonCanonical\(\[\.\.\.base\.candidates, \.\.\.added\.candidates\], 900\)/);
  assert.match(merge, /sourceTags: \[\.\.\.new Set/);
});

test("one-click runner starts from a 1688 URL and resumes after browser collection", () => {
  assert.match(auto, /keywordEngineElonLab\.autoRunToStep4\.v1/);
  assert.match(auto, /validate1688Url/);
  assert.match(auto, /buildKeywordElonBrowserImportUrl/);
  assert.match(auto, /parse1688OfferId/);
  assert.match(auto, /same1688Offer/);
  assert.match(auto, /markerOfferId === sessionOfferId/);
  assert.match(auto, /status: "armed"/);
  assert.match(auto, /status !== "armed"/);
  assert.match(auto, /sourceReady/);
  assert.match(auto, /FINAL RESULT 받기/);
  assert.match(layout, /KeywordElonAutoRunToStep4/);
  assert.match(layout, /<KeywordElonAutoRunToStep4 \/>/);
});

test("one-click pipeline performs STEP 1, STEP 2 round 1, STEP 3 rounds 1-3, STEP 4 and final title", () => {
  assert.match(auto, /action: "analyze_identity"/);
  assert.match(auto, /stage1Review: "pass"/);
  assert.match(auto, /action: "discover_keywords"/);
  assert.match(auto, /stage2Round: 1/);
  assert.match(auto, /for \(let round = 1; round <= 3; round \+= 1\)/);
  assert.match(auto, /action: "expand_from_passing"/);
  assert.match(auto, /mergeKeywordElonCandidates/);
  assert.match(auto, /mergeKeywordElonDiscovery/);
  assert.match(auto, /keywordEngineElonLab\.step4\.customBlockedTerms\.v1/);
  assert.match(auto, /selectKeywordElonStep4Union/);
  assert.match(auto, /readKeywordElonSelectionThresholds/);
  assert.match(auto, /cutoff: 0/);
  assert.match(auto, /action: "filter_prohibited_keywords"/);
  assert.match(auto, /action: "generate_title"/);
  assert.match(auto, /일괄 실행 완료 · 표준값 60 \/ 65 \/ 90/);
});

test("FINAL RESULT stays in the top cockpit after STEP 4 without forcing a page reload", () => {
  assert.match(auto, /const \[resultSession, setResultSession\]/);
  assert.match(auto, /setResultSession\(current\)/);
  assert.match(auto, /FINAL RESULT 생성 완료/);
  assert.match(auto, /navigator\.clipboard\.writeText/);
  assert.match(auto, /STEP 5 자동 실행 안 함/);
  assert.doesNotMatch(auto, /window\.location\.reload/);
});

test("long diagnostic content is collapsed by default and STEP 5 remains manual", () => {
  assert.match(layout, /KeywordElonCollapsibleSection/);
  assert.match(layout, /STEP 1~4 세부내용/);
  assert.match(layout, /STEP 5 · 다양성 보조/);
  assert.match(layout, /수동 실행/);
  assert.match(collapsible, /<details/);
  assert.match(collapsible, /펼쳐보기/);
  assert.match(collapsible, /숨기기/);
  assert.doesNotMatch(collapsible, /<details[^>]*\sopen(?:=|\s|>)/);
});

test("new cumulative and one-click files are covered by dedicated CI", () => {
  assert.match(workflow, /KeywordElonAutoRunToStep4\.tsx/);
  assert.match(workflow, /KeywordElonCollapsibleSection\.tsx/);
  assert.match(workflow, /keywordEngineElonLabV2Merge\.ts/);
  assert.match(workflow, /keywordEngineElonLabRoundsAndAuto\.test\.mjs/);
});

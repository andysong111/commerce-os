import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile("src/app/api/keyword-engine-elon-lab/route.ts", "utf8");
const layout = await readFile("src/app/keyword-engine-elon-lab/layout.tsx", "utf8");
const component = await readFile("src/app/keyword-engine-elon-lab/KeywordElonStep3Expansion.tsx", "utf8");
const expansion = await readFile("src/lib/keywordEngineElonLabV2Step3.ts", "utf8");
const enrichment = await readFile("src/lib/keywordEngineElonLabV2DemandEnrichment.ts", "utf8");
const merge = await readFile("src/lib/keywordEngineElonLabV2Merge.ts", "utf8");

test("STEP 3 expands only from passing keywords and preserves prior material", () => {
  assert.match(component, /row\.safetyPass && row\.qualityScore >=/);
  assert.match(component, /uniqueKeywordElonCanonical/);
  assert.match(component, /Seed 최대 8개/);
  assert.match(component, /action: "expand_from_passing"/);
  assert.match(component, /existingDiscovery: base\.discovery/);
  assert.match(component, /existingCandidates: base\.scoredCandidates/);
});

test("STEP 3 uses evidence and SearchAd while excluding existing candidates", () => {
  assert.match(expansion, /mineKeywordElonApiHubMarket/);
  assert.match(expansion, /discoverKeywordElonSearchAd/);
  assert.match(expansion, /STEP3_CANDIDATE_LIMIT = 300/);
  assert.match(expansion, /existingKeys/);
  assert.match(expansion, /!blocked\.has/);
  assert.match(expansion, /step3_api_hub_evidence/);
  assert.match(expansion, /step3_searchad_related/);
  assert.match(expansion, /STEP3_EXPANSION_SUMMARY/);
});

test("STEP 3 merges every round and regenerates title only at the target round", () => {
  assert.match(component, /action: "score_keywords"/);
  assert.match(component, /mergeKeywordElonCandidates/);
  assert.match(component, /mergeKeywordElonDiscovery/);
  assert.match(component, /newlyPassed/);
  assert.match(component, /if \(makeTitle\)/);
  assert.match(component, /action: "generate_title"/);
  assert.match(component, /window\.location\.reload/);
  assert.match(component, /누적 전체 통과/);
  assert.match(merge, /uniqueKeywordElonCanonical\(\[\.\.\.base\.candidates, \.\.\.added\.candidates\], 900\)/);
});

test("one STEP 3 click automatically reaches round 3 and later clicks add one round", () => {
  assert.match(component, /const targetRound = currentRound < 3 \? 3 : currentRound \+ 1/);
  assert.match(component, /round <= targetRound/);
  assert.match(component, /round === targetRound/);
  assert.match(component, /첫 실행은 round 1→2→3을 한 번에 자동 진행합니다/);
  assert.match(component, /기본 자동 round 3/);
  assert.match(component, /STEP 3 · 추가발굴 round/);
});

test("STEP 3 route and layout are connected", () => {
  assert.match(route, /expandKeywordElonFromPassing/);
  assert.match(route, /action === "expand_from_passing"/);
  assert.match(route, /step3ExpansionAvailable: true/);
  assert.match(layout, /KeywordElonStep3Expansion/);
  assert.match(layout, /<KeywordElonStep3Expansion \/>/);
});

test("STEP 3 evidence terms receive demand-enrichment priority", () => {
  assert.match(enrichment, /step3_api_hub_evidence/);
  assert.match(enrichment, /step3_searchad_related/);
  assert.match(enrichment, /return 8/);
  assert.match(enrichment, /return 7/);
});

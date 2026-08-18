import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const route = await readFile("src/app/api/keyword-engine-elon-lab/route.ts", "utf8");
const zipRoute = await readFile("src/app/api/keyword-engine-elon-lab/collector-zip/route.ts", "utf8");
const server = await readFile("src/lib/keywordEngineElonLabV2Server.ts", "utf8");
const searchAd = await readFile("src/lib/keywordEngineElonLabV2SearchAd.ts", "utf8");
const apiHub = await readFile("src/lib/keywordEngineElonLabV2ApiHub.ts", "utf8");
const discovery = await readFile("src/lib/keywordEngineElonLabV2Discovery.ts", "utf8");
const marketRecall = await readFile("src/lib/keywordEngineElonLabV2MarketRecall.ts", "utf8");
const demandEnrichment = await readFile("src/lib/keywordEngineElonLabV2DemandEnrichment.ts", "utf8");
const scoring = await readFile("src/lib/keywordEngineElonLabV2Scoring.ts", "utf8");
const domain = await readFile("src/lib/keywordEngineElonLabV2.ts", "utf8");
const page = await readFile("src/app/keyword-engine-elon-lab/page.tsx", "utf8");
const browserImport = await readFile("src/lib/keywordEngineElonLabBrowserImport.ts", "utf8");
const demandSummary = await readFile("src/app/keyword-engine-elon-lab/KeywordElonDemandSummary.tsx", "utf8");
const collector1688Path = "public/keyword-lab-collector/content-1688.js";
const collectorOpsPath = "public/keyword-lab-collector/content-ops.js";
const collector1688 = await readFile(collector1688Path, "utf8");
const collectorOps = await readFile(collectorOpsPath, "utf8");
const collectorManifest = JSON.parse(await readFile("public/keyword-lab-collector/manifest.json", "utf8"));

test("V2 has no Shopling or Supabase write dependency", () => {
  assert.doesNotMatch(route, /Shopling|Supabase|keywordEngineElonLabStore|keywordEngineElonLabShopling/);
  assert.doesNotMatch(page, /review_stage_batch|run_stage_one|goods_key/);
});

test("dedicated collector remains independent from detail-page SaaS", () => {
  assert.match(collector1688, /extractProductName/);
  assert.match(collector1688, /extractStructuredOptionGroups/);
  assert.match(collector1688, /commerce_os_keyword_lab_collect/);
  assert.doesNotMatch(collector1688, /imageCandidates|fetchAndPrepareImage|AI-Saurus/);
  assert.match(browserImport, /collectorVersion/);
  assert.doesNotMatch(browserImport, /AI-Saurus/);
});

test("collector v0.1.1 still supports canonical and Vercel deployment URLs", () => {
  assert.equal(collectorManifest.version, "0.1.1");
  assert.ok(collectorManifest.host_permissions.includes("https://*.vercel.app/*"));
  assert.match(collectorOps, /commerceOsKeywordLabCollectorVersion/);
  assert.match(browserImport, /KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION = "0\.1\.1"/);
  for (const path of [collector1688Path, collectorOpsPath]) {
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  assert.match(zipRoute, /commerce-os-keyword-lab-collector-v0\.1\.1\.zip/);
});

test("identity analysis still uses only 1688 source truth", () => {
  assert.match(server, /판매자가 만든 한국 모델명은 절대 사용하지 않는다/);
  assert.match(server, /1688 중국 원본 상품명·옵션·보조텍스트만 근거/);
});

test("NAVER API HUB is the V5 market-language mine", () => {
  assert.match(apiHub, /NAVER_API_HUB_CLIENT_ID/);
  assert.match(apiHub, /NAVER_API_HUB_CLIENT_SECRET/);
  assert.match(apiHub, /X-NCP-APIGW-API-KEY-ID/);
  assert.match(apiHub, /X-NCP-APIGW-API-KEY/);
  assert.match(apiHub, /\/search\/v1\/blog/);
  assert.match(apiHub, /\/search\/v1\/cafearticle/);
  assert.match(apiHub, /\/search\/v1\/webkr/);
  assert.match(apiHub, /rankTerms/);
  assert.match(apiHub, /sourceCount/);
  assert.match(apiHub, /documentCount/);
  assert.doesNotMatch(marketRecall, /openapi\.naver\.com\/v1\/search\/shop\.json/);
  assert.doesNotMatch(marketRecall, /NAVER_SEARCH_CLIENT_ID|NAVER_SEARCH_CLIENT_SECRET/);
});

test("Market Bridge is generic and feeds API HUB before SearchAd", () => {
  assert.match(marketRecall, /Market Bridge Seed 생성기/);
  assert.doesNotMatch(marketRecall, /코집게·코교정기·코높이기·콧대높이기·코뽕/);
  assert.match(marketRecall, /mineKeywordElonApiHubMarket/);
  assert.match(marketRecall, /apiHubDocumentCount/);
  assert.match(discovery, /observedApiHubMarketTerms/);
  assert.match(discovery, /api_hub_market_term/);
  assert.match(discovery, /MARKET_RECALL_V5_SUMMARY/);
  assert.match(discovery, /discoverKeywordElonSearchAd\(searchAdSeeds\)/);
  assert.match(discovery, /marketRecallVersion: "v5"/);
});

test("SearchAd expands more market seeds while preserving rate-limit protection", () => {
  assert.match(searchAd, /REQUEST_INTERVAL_MS = 1_800/);
  assert.match(searchAd, /RATE_LIMIT_BACKOFF_MS = 6_500/);
  assert.match(searchAd, /INITIAL_SEED_LIMIT = 10/);
  assert.match(searchAd, /DEMAND_EXPANSION_SEED_LIMIT = 4/);
  assert.match(searchAd, /DEMAND_EXPANSION_MIN_SEARCH = 20/);
  assert.match(searchAd, /DEMAND_ENRICH_LIMIT = 12/);
  assert.match(searchAd, /fetchSeedWithRateLimitRecovery/);
  assert.match(searchAd, /enrichKeywordElonSearchAdDemand/);
  assert.match(searchAd, /SEARCHAD_RATE_LIMIT_COOLDOWN_REQUIRED/);
  assert.match(searchAd, /\[REDACTED\]/);
});

test("demand enrichment prefers short API HUB and market terms", () => {
  assert.match(route, /action === "enrich_demand"/);
  assert.match(demandEnrichment, /api_hub_market_term/);
  assert.match(demandEnrichment, /market_bridge_seed/);
  assert.match(demandEnrichment, /sourcePriority/);
  assert.match(demandEnrichment, /compactKeywordElonKey\(a\.keyword\)\.length/);
  assert.match(demandEnrichment, /DEMAND_ENRICH_V5_SUMMARY/);
});

test("AI scoring remains adaptive demand-first and canonical search keys are available", () => {
  assert.match(route, /scoreKeywordElonCandidatesBatched/);
  assert.match(route, /maxDuration = 500/);
  assert.match(scoring, /OPENAI_TIMEOUT_MS = 42_000/);
  assert.match(scoring, /SCORE_CHUNK_SIZE = 12/);
  assert.match(scoring, /calculateKeywordElonQuality/);
  assert.match(domain, /KEYWORD_ELON_V2_RELEVANCE_GATE = 80/);
  assert.match(domain, /KEYWORD_ELON_V2_SHOPPING_INTENT_GATE = 70/);
  assert.match(domain, /demandScore\*0\.55|demandScore \* 0\.55/);
  assert.match(domain, /keywordElonSearchKeyword/);
  assert.match(domain, /searchKeyword\?: string/);
});

test("V5 diagnostic UI exposes API HUB market mine and no-space demand TOP", () => {
  assert.match(demandSummary, /MARKET RECALL V5/);
  assert.match(demandSummary, /API HUB 시장어 광산/);
  assert.match(demandSummary, /API HUB 반복 시장어/);
  assert.match(demandSummary, /apiHubDocumentCount/);
  assert.match(demandSummary, /NAVER_API_HUB_CLIENT_ID/);
  assert.match(demandSummary, /월검색량 TOP · 검색용 no-space/);
  assert.match(demandSummary, /row\.searchKeyword \|\| row\.searchKey/);
});

test("route exposes API HUB readiness and errors remain diagnosable", () => {
  assert.match(route, /apiHubConfigured/);
  assert.match(route, /version: 5/);
  assert.match(route, /errorStage/);
  assert.match(page, /STEP 2 실행 오류 · 상세 진단/);
  assert.match(page, /서버가 JSON이 아닌 응답을 반환했습니다/);
});

test("title generation remains title-eligible and byte capped", () => {
  assert.match(server, /qualityScore >= input\.cutoff && row\.titleEligible/);
  assert.match(server, /truncateUtf8\(.*100/);
});

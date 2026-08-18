import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const route = await readFile("src/app/api/keyword-engine-elon-lab/route.ts", "utf8");
const zipRoute = await readFile("src/app/api/keyword-engine-elon-lab/collector-zip/route.ts", "utf8");
const server = await readFile("src/lib/keywordEngineElonLabV2Server.ts", "utf8");
const searchAd = await readFile("src/lib/keywordEngineElonLabV2SearchAd.ts", "utf8");
const discovery = await readFile("src/lib/keywordEngineElonLabV2Discovery.ts", "utf8");
const scoring = await readFile("src/lib/keywordEngineElonLabV2Scoring.ts", "utf8");
const domain = await readFile("src/lib/keywordEngineElonLabV2.ts", "utf8");
const page = await readFile("src/app/keyword-engine-elon-lab/page.tsx", "utf8");
const browserImport = await readFile("src/lib/keywordEngineElonLabBrowserImport.ts", "utf8");
const demandSummary = await readFile("src/app/keyword-engine-elon-lab/KeywordElonDemandSummary.tsx", "utf8");
const collector1688Path = "public/keyword-lab-collector/content-1688.js";
const collectorOpsPath = "public/keyword-lab-collector/content-ops.js";
const collector1688 = await readFile(collector1688Path, "utf8");
const collectorOps = await readFile(collectorOpsPath, "utf8");
const collectorManifest = JSON.parse(
  await readFile("public/keyword-lab-collector/manifest.json", "utf8"),
);

test("V2 has no Shopling or Supabase write dependency", () => {
  assert.doesNotMatch(route, /Shopling|Supabase|keywordEngineElonLabStore|keywordEngineElonLabShopling/);
  assert.doesNotMatch(page, /review_stage_batch|run_stage_one|goods_key/);
});

test("dedicated collector uses rendered 1688 DOM for title and structured option groups", () => {
  assert.match(collector1688, /extractProductName/);
  assert.match(collector1688, /extractJsonProductNames/);
  assert.match(collector1688, /extractStructuredOptionGroups/);
  assert.match(collector1688, /GROUP_PATTERN/);
  assert.match(collector1688, /supplierOptionGroups/);
  assert.match(collector1688, /commerce_os_keyword_lab_collect/);
  assert.match(collector1688, /commerce_os_keyword_lab_return/);
  assert.doesNotMatch(collector1688, /imageCandidates|fetchAndPrepareImage|AI-Saurus/);
});

test("collector and Lab handoff are independent from the detail-page SaaS", () => {
  assert.match(collector1688, /commerce-os-keyword-lab-collector/);
  assert.match(browserImport, /collectorVersion/);
  assert.match(page, /Keyword Lab Collector/);
  assert.doesNotMatch(page, /AI-Saurus/);
  assert.doesNotMatch(browserImport, /AI-Saurus/);
  assert.doesNotMatch(collector1688, /ai-saurus|detail-page/i);
});

test("collector v0.1.1 supports canonical and Vercel deployment URLs", () => {
  assert.equal(collectorManifest.version, "0.1.1");
  assert.ok(collectorManifest.host_permissions.includes("https://*.vercel.app/*"));
  const opsScript = collectorManifest.content_scripts.find((item) =>
    Array.isArray(item.js) && item.js.includes("content-ops.js"),
  );
  assert.ok(opsScript);
  assert.ok(opsScript.matches.includes("https://*.vercel.app/*"));
  assert.ok(opsScript.include_globs.includes("https://commerce-os-ops-center-*.vercel.app/*"));
  assert.match(collectorOps, /host\.startsWith\("commerce-os-ops-center-"\)/);
  assert.match(browserImport, /KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION = "0\.1\.1"/);
});

test("collector installer zip contains only the dedicated collector package", () => {
  assert.match(zipRoute, /public\/keyword-lab-collector/);
  assert.match(zipRoute, /manifest\.json/);
  assert.match(zipRoute, /content-1688\.js/);
  assert.match(zipRoute, /content-ops\.js/);
  assert.match(zipRoute, /README\.txt/);
  assert.match(zipRoute, /commerce-os-keyword-lab-collector-v0\.1\.1\.zip/);
});

test("collector exposes its installed version to the Ops Center page", () => {
  assert.match(collectorOps, /commerceOsKeywordLabCollectorVersion/);
  assert.match(collectorOps, /commerce-os-keyword-lab-collector-ready/);
  assert.match(page, /commerceOsKeywordLabCollectorVersion/);
  assert.match(page, /KEYWORD_ELON_REQUIRED_COLLECTOR_VERSION/);
});

test("collector JavaScript is syntactically valid", () => {
  for (const path of [collector1688Path, collectorOpsPath]) {
    const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
});

test("server-side 1688 collection remains only a soft fallback", () => {
  assert.match(server, /validate1688Url/);
  assert.match(server, /중국 상품명과 옵션명을 직접 붙여넣으면 STEP 1을 계속할 수 있습니다/);
  assert.match(page, /서버 보조수집/);
});

test("identity analysis explicitly forbids seller model names", () => {
  assert.match(server, /판매자가 만든 한국 모델명은 절대 사용하지 않는다/);
  assert.match(server, /1688 중국 원본 상품명·옵션·보조텍스트만 근거/);
});

test("SearchAd calls are paced, recover from 429, and expand top demand seeds at depth two", () => {
  assert.match(searchAd, /REQUEST_INTERVAL_MS = 1_800/);
  assert.match(searchAd, /RATE_LIMIT_BACKOFF_MS = 6_500/);
  assert.match(searchAd, /DEMAND_EXPANSION_SEED_LIMIT = 3/);
  assert.match(searchAd, /DEMAND_EXPANSION_MIN_SEARCH = 50/);
  assert.match(searchAd, /chooseDemandExpansionSeeds/);
  assert.match(searchAd, /fetchSeedWithRateLimitRecovery/);
  assert.match(searchAd, /expansionSeeds/);
  assert.match(searchAd, /explorationDepth: expansionSeeds\.length \? 2 : 1/);
  assert.match(searchAd, /SEARCHAD_RATE_LIMIT_COOLDOWN_REQUIRED/);
  assert.match(searchAd, /\[REDACTED\]/);
});

test("candidate discovery fails open and tags second-depth demand exploration", () => {
  assert.match(route, /discoverKeywordElonCandidatesResilient/);
  assert.match(discovery, /AI_DISCOVERY_TIMEOUT_MS = 70_000/);
  assert.match(discovery, /Promise\.allSettled/);
  assert.match(discovery, /AI_DISCOVERY_TIMEOUT/);
  assert.match(discovery, /SearchAd\/Seed 후보로 계속 진행/);
  assert.match(discovery, /\.\.\.seeds, \.\.\.ai\.keywords, \.\.\.relatedKeywords/);
  assert.match(discovery, /searchad_demand_depth2/);
  assert.match(discovery, /DEMAND_DEPTH2_USED/);
  assert.match(discovery, /demandExpansionSeeds/);
  assert.match(discovery, /demandExplorationDepth/);
  assert.match(discovery, /DISCOVERY_LOW_RECALL/);
});

test("AI scoring uses small low-output chunks and applies demand-first safety gate", () => {
  assert.match(route, /scoreKeywordElonCandidatesBatched/);
  assert.match(route, /maxDuration = 500/);
  assert.match(scoring, /OPENAI_TIMEOUT_MS = 42_000/);
  assert.match(scoring, /SCORE_CHUNK_SIZE = 12/);
  assert.match(scoring, /SCORE_CONCURRENCY = 1/);
  assert.match(scoring, /max_output_tokens: 2_600/);
  assert.match(scoring, /keyword_elon_semantic_scores_v5/);
  assert.match(scoring, /scoreRationale/);
  assert.doesNotMatch(scoring, /required: \[[\s\S]*"rationale"/);
  assert.match(scoring, /AI_SCORE_TIMEOUT/);
  assert.match(scoring, /AI_SCORE_INCOMPLETE/);
  assert.match(scoring, /AI_SCORE_EMPTY_OUTPUT/);
  assert.match(scoring, /AI_SCORE_HTTP_/);
  assert.match(scoring, /AI_SCORE_ALL_CHUNKS_FAILED/);
  assert.match(scoring, /calculateKeywordElonQuality/);
  assert.match(scoring, /calculated\.safetyReason/);
  assert.match(scoring, /Number\(b\.safetyPass\) - Number\(a\.safetyPass\)/);
  assert.match(domain, /KEYWORD_ELON_V2_RELEVANCE_GATE = 80/);
  assert.match(domain, /KEYWORD_ELON_V2_SHOPPING_INTENT_GATE = 70/);
  assert.match(domain, /demandScore \* 0\.55/);
  assert.match(domain, /qualityScore = safetyPass \? opportunityScore : 0/);
  assert.match(demandSummary, /월검색량 TOP/);
  assert.match(demandSummary, /상품 정확성 TOP/);
});

test("route and STEP 2 UI expose exact failure stage and message", () => {
  assert.match(route, /errorStage/);
  assert.match(route, /\[\$\{action\}\]/);
  assert.match(page, /STEP 2 실행 오류 · 상세 진단/);
  assert.match(page, /session\.lastMessage/);
  assert.match(page, /수집 후보/);
  assert.match(page, /SearchAd 연관어/);
  assert.match(page, /점수 완료/);
});

test("title generation is derived from scored title-eligible keywords and capped at 100 UTF-8 bytes", () => {
  assert.match(server, /qualityScore >= input\.cutoff && row\.titleEligible/);
  assert.match(server, /truncateUtf8\(.*100/);
  assert.match(server, /고득점 titleEligible 키워드를 우선 재료/);
});

test("client shows non-JSON server failures instead of silently breaking", () => {
  assert.match(page, /서버가 JSON이 아닌 응답을 반환했습니다/);
  assert.match(page, /HTTP \$\{response\.status\}/);
});

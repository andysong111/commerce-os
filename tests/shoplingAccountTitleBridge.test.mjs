import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL("../public/shopling-account-title-bridge/manifest.json", import.meta.url);
const titleContentPath = new URL("../public/shopling-account-title-bridge/content-shopling-account-titles.js", import.meta.url);
const listContentPath = new URL("../public/shopling-account-title-bridge/content-shopling-product-list-batch.js", import.meta.url);
const registryListBridgePath = new URL("../public/shopling-account-title-bridge/content-shopling-product-list-registry-bridge.js", import.meta.url);
const pipelineContentPath = new URL("../public/shopling-account-title-bridge/content-shopling-pipeline.js", import.meta.url);
const frameBridgePath = new URL("../public/shopling-account-title-bridge/content-shopling-pipeline-frame-bridge.js", import.meta.url);
const titleBackgroundPath = new URL("../public/shopling-account-title-bridge/background-shopling-title-batch.js", import.meta.url);
const titleRegistryBackgroundPath = new URL("../public/shopling-account-title-bridge/background-shopling-title-registry.js", import.meta.url);
const pipelineBackgroundPath = new URL("../public/shopling-account-title-bridge/background-shopling-pipeline.js", import.meta.url);
const backgroundRootPath = new URL("../public/shopling-account-title-bridge/background-shopling-root.js", import.meta.url);
const backgroundSeoPath = new URL("../public/shopling-account-title-bridge/background-shopling-seo-keywords.js", import.meta.url);
const downloadRoutePath = new URL("../src/app/api/shopling-account-title-bridge/download/route.ts", import.meta.url);
const keywordPoolRoutePath = new URL("../src/app/api/shopling-account-title-bridge/keyword-pool/route.ts", import.meta.url);
const titleRegistryRoutePath = new URL("../src/app/api/shopling-account-title-bridge/title-registry/route.ts", import.meta.url);
const pipelineRoutePath = new URL("../src/app/api/shopling-account-title-bridge/pipeline/route.ts", import.meta.url);
const keywordPoolLibPath = new URL("../src/lib/shoplingTitleKeywordPool.ts", import.meta.url);
const pipelineMigrationPath = new URL("../supabase/migrations/202608300001_shopling_market_pipeline_idempotency_v05.sql", import.meta.url);

test("Shopling bridge v0.5.2 keeps one-button flow and adds OPS registry-backed title batch", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.5.2");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://a.shopling.co.kr/*",
    "https://commerce-os-ops-center.vercel.app/*",
  ]);
  assert.equal(manifest.background.service_worker, "background-shopling-root.js");
  assert.deepEqual(manifest.content_scripts[1].js, [
    "content-shopling-product-list-batch.js",
    "content-shopling-product-list-registry-bridge.js",
  ]);
  assert.deepEqual(manifest.content_scripts[2].matches, ["https://a.shopling.co.kr/*"]);
  assert.deepEqual(manifest.content_scripts[2].js, [
    "content-shopling-pipeline.js",
    "content-shopling-pipeline-frame-bridge.js",
  ]);
  assert.equal(manifest.content_scripts[2].all_frames, true);
});

test("mall-title bridge still uses verified Shopling and SEO tokens only", async () => {
  const source = await readFile(titleContentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const MAX_TITLE_BYTES = 100/);
  assert.match(source, /buildVerifiedTokenPool/);
  assert.match(source, /SEO_KEYWORD_POOL_MESSAGE/);
  assert.match(source, /seo_master_pool/);
  assert.match(source, /await applyDiversification\(retryAttempt\)/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("background root loads title batch, registry reader, SEO pool and market pipeline", async () => {
  const root = await readFile(backgroundRootPath, "utf8");
  assert.match(root, /background-shopling-title-batch\.js/);
  assert.match(root, /background-shopling-title-registry\.js/);
  assert.match(root, /background-shopling-seo-keywords\.js/);
  assert.match(root, /background-shopling-pipeline\.js/);
  assert.doesNotMatch(root, /background-shopling-market-send\.js/);
});

test("SEO keyword background remains read-only and never sends Shopling credentials", async () => {
  const source = await readFile(backgroundSeoPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /keyword-pool/);
  assert.match(source, /credentials: "omit"/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("keyword-pool API keeps safety filtering", async () => {
  const route = await readFile(keywordPoolRoutePath, "utf8");
  const helper = await readFile(keywordPoolLibPath, "utf8");
  assert.match(route, /shopling_product_group_registry/);
  assert.match(route, /seo_run_jobs/);
  assert.match(helper, /safetyPass === false/);
  assert.match(helper, /titleEligible === false/);
  assert.match(helper, /categoryAligned === false/);
  assert.match(helper, /blocked === true/);
  assert.match(helper, /prohibited === true/);
});

test("legacy list title bridge still preserves old page-collection diagnostics", async () => {
  const source = await readFile(listContentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /미분산 상품 일괄 처리/);
  assert.match(source, /collected\.expected > collected\.goodsKeys\.length/);
  assert.match(source, /credentials: "include"/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("registry title bridge intercepts purple button and ignores Shopling page size/current results", async () => {
  const source = await readFile(registryListBridgePath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /TITLE_REGISTRY_MESSAGE/);
  assert.match(source, /Shopling 현재 검색결과를 사용하지 않고 OPS CENTER 등록 원장에서 goods key를 불러옵니다/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /CHUNK_SIZE = 500/);
  assert.match(source, /goodsKeys\.slice\(run\.nextIndex, run\.nextIndex \+ CHUNK_SIZE\)/);
  assert.match(source, /현재 조회조건\/화면출력 수와 무관/);
  assert.match(source, /looksLikeProductListUi/);
  assert.doesNotMatch(source, /credentials:\s*["']include["']/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("title registry background reads only Commerce OS registry endpoint without Shopling credentials", async () => {
  const source = await readFile(titleRegistryBackgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /title-registry/);
  assert.match(source, /TITLE_REGISTRY_BRIDGE = "v0\.5\.2"/);
  assert.match(source, /credentials: "omit"/);
  assert.doesNotMatch(source, /a\.shopling\.co\.kr/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("title registry API returns sanitized successful Shopling goods keys only", async () => {
  const source = await readFile(titleRegistryRoutePath, "utf8");
  assert.match(source, /const BRIDGE_VERSION = "v0\.5\.2"/);
  assert.match(source, /shopling_product_group_registry/);
  assert.match(source, /\.eq\("shopling_status", "success"\)/);
  assert.match(source, /select\("goods_key,registered_at"\)/);
  assert.match(source, /\/\^\\d\{5,9\}\$\//);
  assert.doesNotMatch(source, /ptn_goods_cd|title|keyword|price|image|password|cookie/i);
});

test("one-button content starts from empty prodList and uses exact ptn_goods_cd rather than DM prefix", async () => {
  const source = await readFile(pipelineContentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /\/prod\\\/prodList\\\.phtml/);
  assert.match(source, /신규상품 전체 자동처리/);
  assert.match(source, /현재 Shopling 조회조건과 무관/);
  assert.match(source, /setInputValue\(searchInput, context\.ptnGoodsCd\)/);
  assert.match(source, /matchingRows\.length !== 1/);
  assert.match(source, /canonical\(entry\.label\)\.includes\(exact\)/);
  assert.doesNotMatch(source, /setInputValue\(searchInput, context\.searchCode\)/);
  assert.match(source, /TITLE_BATCH_START_MESSAGE/);
  assert.match(source, /startMarketAfterTitles/);
});

test("frame bridge recognizes Shopling product-list DOM without relying on exact iframe path", async () => {
  const source = await readFile(frameBridgePath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /function isProductListDocument\(\)/);
  assert.match(source, /총\\s\*조회수/);
  assert.match(source, /상품\\s\*조회\\s\*수정|상품조회수정/);
  assert.match(source, /hasSelfCodeSearchOption/);
  assert.match(source, /신규상품 전체 자동처리 · 동시 2창/);
  assert.match(source, /PIPE_CLAIM_MESSAGE/);
  assert.match(source, /TITLE_BATCH_START_MESSAGE/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("one-button content enforces Shopling unregistered check and durable submit lock before click", async () => {
  const source = await readFile(pipelineContentPath, "utf8");
  assert.match(source, /쇼핑몰.*미등록/);
  assert.match(source, /no_exact_unregistered_product/);
  assert.match(source, /PIPE_MARKET_ARM_SUBMIT_MESSAGE/);
  assert.match(source, /durable_submit_lock_failed/);
  const armIndex = source.indexOf("PIPE_MARKET_ARM_SUBMIT_MESSAGE");
  const clickIndex = source.indexOf("clickElement(sendButton)");
  assert.ok(armIndex >= 0 && clickIndex > armIndex);
  assert.match(source, /submit_result_ambiguous/);
  assert.match(source, /자동 재전송은 차단/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("title background keeps existing retry and verification behavior", async () => {
  const source = await readFile(titleBackgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const PAGE_TIMEOUT_MS = 60000/);
  assert.match(source, /const MAX_AUTO_RETRIES = 2/);
  assert.match(source, /save_verify_duplicate/);
  assert.match(source, /chrome\.storage\.session/);
  assert.match(source, /itemResults/);
});

test("pipeline background claims durable tasks, uses two lanes, and never retries after submit lock", async () => {
  const source = await readFile(pipelineBackgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /PIPE_MAX_LANES = 2/);
  assert.match(source, /PIPE_MAX_AUTO_RETRIES = 1/);
  assert.match(source, /PIPE_MAX_TASKS = 300/);
  assert.match(source, /shopling-account-title-bridge\/pipeline/);
  assert.match(source, /ptnGoodsCd\.toUpperCase\(\)\.startsWith/);
  assert.match(source, /!\["submit-armed", "submitted"\]\.includes\(stage\)/);
  assert.match(source, /pipeArmSubmit\(run\.claimRunId, task\.goodsKey\)/);
  assert.match(source, /window_closed_after_submit_lock/);
  assert.match(source, /already_registered/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("pipeline API exposes claim, submit-lock, and terminal-report RPCs only", async () => {
  const source = await readFile(pipelineRoutePath, "utf8");
  assert.match(source, /const BRIDGE_VERSION = "v0\.5\.0"/);
  assert.match(source, /claim_shopling_market_pipeline_tasks/);
  assert.match(source, /arm_shopling_market_pipeline_submit/);
  assert.match(source, /report_shopling_market_pipeline_task/);
  assert.match(source, /ptnGoodsCd/);
  assert.match(source, /goodsKey/);
  assert.doesNotMatch(source, /password|cookie/i);
});

test("pipeline migration permanently baselines legacy rows and never auto-requeues stale claims", async () => {
  const source = await readFile(pipelineMigrationPath, "utf8");
  assert.match(source, /shopling_market_pipeline_ledger/);
  assert.match(source, /primary key \(owner_id, goods_key\)/i);
  assert.match(source, /legacy_ignored/);
  assert.match(source, /2026-08-30 11:17:06\+00/);
  assert.match(source, /status = 'claimed'/);
  assert.match(source, /stale_claim_requires_review/);
  assert.match(
    source,
    /set status = 'confirm_needed',[\s\S]{0,700}where status = 'claimed'[\s\S]{0,120}claimed_at < now\(\) - interval '2 hours'/i,
  );
  assert.doesNotMatch(
    source,
    /set status = 'queued',[\s\S]{0,700}where status = 'claimed'[\s\S]{0,120}claimed_at < now\(\) - interval '2 hours'/i,
  );
  assert.match(source, /market_status = 'submit_armed'/);
  assert.match(source, /grant execute .* service_role/i);
});

test("Shopling bridge v0.5.2 download ZIP contains registry title bridge and active pipeline workers", async () => {
  const source = await readFile(downloadRoutePath, "utf8");
  assert.ok(source.includes('"content-shopling-product-list-registry-bridge.js"'));
  assert.ok(source.includes('"background-shopling-title-registry.js"'));
  assert.ok(source.includes('"content-shopling-pipeline.js"'));
  assert.ok(source.includes('"content-shopling-pipeline-frame-bridge.js"'));
  assert.ok(source.includes('"background-shopling-pipeline.js"'));
  assert.ok(source.includes('"background-shopling-title-batch.js"'));
  assert.ok(source.includes('"background-shopling-seo-keywords.js"'));
  assert.ok(!source.includes('"content-shopling-market-send.js"'));
  assert.ok(!source.includes('"background-shopling-market-send.js"'));
  assert.ok(source.includes("commerce-os-shopling-account-title-bridge-v0.5.2.zip"));
  assert.ok(source.includes("Commerce OS Shopling Account Title Bridge v0.5.2"));
});

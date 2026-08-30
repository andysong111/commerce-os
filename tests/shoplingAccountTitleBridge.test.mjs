import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL("../public/shopling-account-title-bridge/manifest.json", import.meta.url);
const titleContentPath = new URL("../public/shopling-account-title-bridge/content-shopling-account-titles.js", import.meta.url);
const pipelineContentPath = new URL("../public/shopling-account-title-bridge/content-shopling-pipeline.js", import.meta.url);
const frameBridgePath = new URL("../public/shopling-account-title-bridge/content-shopling-pipeline-frame-bridge.js", import.meta.url);
const stabilityBridgePath = new URL("../public/shopling-account-title-bridge/content-shopling-onebutton-stability-v055.js", import.meta.url);
const titleBackgroundPath = new URL("../public/shopling-account-title-bridge/background-shopling-title-batch.js", import.meta.url);
const titleSupervisorPath = new URL("../public/shopling-account-title-bridge/background-shopling-title-supervisor-v055.js", import.meta.url);
const pipelineBackgroundPath = new URL("../public/shopling-account-title-bridge/background-shopling-pipeline.js", import.meta.url);
const backgroundRootPath = new URL("../public/shopling-account-title-bridge/background-shopling-root.js", import.meta.url);
const backgroundSeoPath = new URL("../public/shopling-account-title-bridge/background-shopling-seo-keywords.js", import.meta.url);
const downloadRoutePath = new URL("../src/app/api/shopling-account-title-bridge/download/route.ts", import.meta.url);
const keywordPoolRoutePath = new URL("../src/app/api/shopling-account-title-bridge/keyword-pool/route.ts", import.meta.url);
const pipelineRoutePath = new URL("../src/app/api/shopling-account-title-bridge/pipeline/route.ts", import.meta.url);
const keywordPoolLibPath = new URL("../src/lib/shoplingTitleKeywordPool.ts", import.meta.url);
const pipelineMigrationPath = new URL("../supabase/migrations/202608300001_shopling_market_pipeline_idempotency_v05.sql", import.meta.url);

test("Shopling bridge v0.5.5 ships one operator flow and persistent alarm recovery", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.5.5");
  assert.deepEqual(manifest.permissions, ["storage", "alarms"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://a.shopling.co.kr/*",
    "https://commerce-os-ops-center.vercel.app/*",
  ]);
  assert.equal(manifest.background.service_worker, "background-shopling-root.js");
  assert.equal(manifest.content_scripts.length, 2);
  assert.deepEqual(manifest.content_scripts[1].js, [
    "content-shopling-pipeline.js",
    "content-shopling-pipeline-frame-bridge.js",
    "content-shopling-onebutton-stability-v055.js",
  ]);
  const manifestText = await readFile(manifestPath, "utf8");
  assert.doesNotMatch(manifestText, /content-shopling-product-list-registry-bridge\.js/);
  assert.doesNotMatch(manifestText, /content-shopling-product-list-batch\.js/);
});

test("mall-title worker still uses verified SEO tokens only", async () => {
  const source = await readFile(titleContentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const MAX_TITLE_BYTES = 100/);
  assert.match(source, /buildVerifiedTokenPool/);
  assert.match(source, /SEO_KEYWORD_POOL_MESSAGE/);
  assert.match(source, /seo_master_pool/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("background root loads only one-button runtime workers plus alarm supervisor", async () => {
  const root = await readFile(backgroundRootPath, "utf8");
  assert.match(root, /background-shopling-title-batch\.js/);
  assert.match(root, /background-shopling-title-supervisor-v055\.js/);
  assert.match(root, /background-shopling-seo-keywords\.js/);
  assert.match(root, /background-shopling-pipeline\.js/);
  assert.doesNotMatch(root, /background-shopling-title-registry\.js/);
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

test("orange one-button market worker still uses exact ptn_goods_cd and durable submit lock", async () => {
  const source = await readFile(pipelineContentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /신규상품 전체 자동처리/);
  assert.match(source, /setInputValue\(searchInput, context\.ptnGoodsCd\)/);
  assert.match(source, /matchingRows\.length !== 1/);
  assert.doesNotMatch(source, /setInputValue\(searchInput, context\.searchCode\)/);
  assert.match(source, /PIPE_MARKET_ARM_SUBMIT_MESSAGE/);
  const armIndex = source.indexOf("PIPE_MARKET_ARM_SUBMIT_MESSAGE");
  const clickIndex = source.indexOf("clickElement(sendButton)");
  assert.ok(armIndex >= 0 && clickIndex > armIndex);
});

test("frame bridge starts title work only for its claimed market goods keys", async () => {
  const source = await readFile(frameBridgePath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /PIPE_CLAIM_MESSAGE/);
  assert.match(source, /TITLE_BATCH_START_MESSAGE/);
  assert.match(source, /const goodsKeys =/);
  assert.match(source, /stage: "title"/);
});

test("v0.5.5 stability bridge hands title completion to market without focus dependency", async () => {
  const source = await readFile(stabilityBridgePath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /TITLE_RUN_KEY/);
  assert.match(source, /TITLE_LAST_RUN_KEY/);
  assert.match(source, /MARKET_LAST_RUN_KEY/);
  assert.match(source, /PIPE_MARKET_START_MESSAGE/);
  assert.match(source, /titleRunCoversUiRun/);
  assert.match(source, /marketEnsured/);
  assert.match(source, /chrome\.storage\.onChanged/);
  assert.match(source, /백그라운드 감시 활성/);
  assert.doesNotMatch(source, /window\.addEventListener\("focus"/);
  assert.doesNotMatch(source, /document\.addEventListener\("visibilitychange"/);
  assert.match(source, /outcome: "title_failed"/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("v0.5.5 title supervisor uses chrome alarms and verify-first recovery after save", async () => {
  const source = await readFile(titleSupervisorPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /chrome\.alarms\.create/);
  assert.match(source, /periodInMinutes: 1/);
  assert.match(source, /TITLE_STALE_MS_V055 = 75000/);
  assert.match(source, /verificationSafe = \["saving", "verify-opening", "verify"\]/);
  assert.match(source, /titleSupervisorVerifyUrl/);
  assert.match(source, /background_supervisor_timeout/);
  assert.match(source, /active: false/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("title batch retains retry verification and durable item results", async () => {
  const source = await readFile(titleBackgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const PAGE_TIMEOUT_MS = 60000/);
  assert.match(source, /const MAX_AUTO_RETRIES = 2/);
  assert.match(source, /save_verify_duplicate/);
  assert.match(source, /itemResults/);
  assert.match(source, /LAST_RUN_STORAGE_KEY/);
});

test("market duplicate protections and claim recovery remain unchanged", async () => {
  const background = await readFile(pipelineBackgroundPath, "utf8");
  const route = await readFile(pipelineRoutePath, "utf8");
  const migration = await readFile(pipelineMigrationPath, "utf8");
  assert.match(background, /PIPE_MAX_LANES = 2/);
  assert.match(background, /!\["submit-armed", "submitted"\]\.includes\(stage\)/);
  assert.match(route, /arm_shopling_market_pipeline_submit/);
  assert.match(route, /\.from\("shopling_market_pipeline_ledger"\)/);
  assert.match(route, /\.eq\("claim_run_id", runId\)/);
  assert.match(route, /recoveredClaimRowCount/);
  assert.match(migration, /legacy_ignored/);
  assert.match(migration, /market_status = 'submit_armed'/);
  assert.match(migration, /stale_claim_requires_review/);
});

test("Shopling v0.5.5 ZIP contains only unified operator runtime plus persistent supervisor", async () => {
  const source = await readFile(downloadRoutePath, "utf8");
  assert.ok(source.includes('"content-shopling-onebutton-stability-v055.js"'));
  assert.ok(source.includes('"background-shopling-title-supervisor-v055.js"'));
  assert.ok(source.includes('"background-shopling-pipeline.js"'));
  assert.ok(!source.includes('"content-shopling-product-list-registry-bridge.js"'));
  assert.ok(!source.includes('"content-shopling-product-list-batch.js"'));
  assert.ok(!source.includes('"background-shopling-title-registry.js"'));
  assert.ok(source.includes("commerce-os-shopling-account-title-bridge-v0.5.5.zip"));
  assert.ok(source.includes("Commerce OS Shopling Account Title Bridge v0.5.5"));
});

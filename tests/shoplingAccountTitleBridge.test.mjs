import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL("../public/shopling-account-title-bridge/manifest.json", import.meta.url);
const titleContentPath = new URL("../public/shopling-account-title-bridge/content-shopling-account-titles.js", import.meta.url);
const listContentPath = new URL("../public/shopling-account-title-bridge/content-shopling-product-list-batch.js", import.meta.url);
const registryListBridgePath = new URL("../public/shopling-account-title-bridge/content-shopling-product-list-registry-bridge.js", import.meta.url);
const pipelineContentPath = new URL("../public/shopling-account-title-bridge/content-shopling-pipeline.js", import.meta.url);
const frameBridgePath = new URL("../public/shopling-account-title-bridge/content-shopling-pipeline-frame-bridge.js", import.meta.url);
const stabilityBridgePath = new URL("../public/shopling-account-title-bridge/content-shopling-onebutton-stability-v055.js", import.meta.url);
const titleBackgroundPath = new URL("../public/shopling-account-title-bridge/background-shopling-title-batch.js", import.meta.url);
const titleSupervisorPath = new URL("../public/shopling-account-title-bridge/background-shopling-title-supervisor-v055.js", import.meta.url);
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
const titleLedgerMigrationPath = new URL("../supabase/migrations/202608300002_shopling_title_diversification_ledger_v053.sql", import.meta.url);

test("Shopling bridge v0.5.5 exposes one operator flow and persistent alarm recovery", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.5.5");
  assert.deepEqual(manifest.permissions, ["storage", "alarms"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://a.shopling.co.kr/*",
    "https://commerce-os-ops-center.vercel.app/*",
  ]);
  assert.equal(manifest.background.service_worker, "background-shopling-root.js");
  assert.deepEqual(manifest.content_scripts[2].js, [
    "content-shopling-pipeline.js",
    "content-shopling-pipeline-frame-bridge.js",
    "content-shopling-onebutton-stability-v055.js",
  ]);
});

test("mall-title bridge still uses verified Shopling and SEO tokens only", async () => {
  const source = await readFile(titleContentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const MAX_TITLE_BYTES = 100/);
  assert.match(source, /buildVerifiedTokenPool/);
  assert.match(source, /SEO_KEYWORD_POOL_MESSAGE/);
  assert.match(source, /seo_master_pool/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("background root loads title worker, alarm supervisor, ledger, SEO and market pipeline", async () => {
  const root = await readFile(backgroundRootPath, "utf8");
  assert.match(root, /background-shopling-title-batch\.js/);
  assert.match(root, /background-shopling-title-supervisor-v055\.js/);
  assert.match(root, /background-shopling-title-registry\.js/);
  assert.match(root, /background-shopling-seo-keywords\.js/);
  assert.match(root, /background-shopling-pipeline\.js/);
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

test("legacy purple title flow remains internally available but unified UI suppresses its operator panel", async () => {
  const purple = await readFile(registryListBridgePath, "utf8");
  const unified = await readFile(stabilityBridgePath, "utf8");
  assert.doesNotThrow(() => new Function(purple));
  assert.doesNotThrow(() => new Function(unified));
  assert.match(purple, /commerce-os-shopling-product-list-batch/);
  assert.match(unified, /LEGACY_PURPLE_PANEL_ID = "commerce-os-shopling-product-list-batch"/);
  assert.match(unified, /display:none!important/);
  assert.match(unified, /신규상품 전체 자동처리/);
});

test("legacy page collector remains only as fallback diagnostics", async () => {
  const source = await readFile(listContentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /미분산 상품 일괄 처리/);
  assert.match(source, /collected\.expected > collected\.goodsKeys\.length/);
  assert.match(source, /credentials: "include"/);
});

test("title ledger background remains service-only helper with no Shopling credentials", async () => {
  const source = await readFile(titleRegistryBackgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /TITLE_REGISTRY_BRIDGE = "v0\.5\.3"/);
  assert.match(source, /credentials: "omit"/);
  assert.doesNotMatch(source, /a\.shopling\.co\.kr/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("title registry API stays ledger-backed and recoverable by run id", async () => {
  const source = await readFile(titleRegistryRoutePath, "utf8");
  assert.match(source, /claim_shopling_title_diversification_tasks/);
  assert.match(source, /report_shopling_title_diversification_task/);
  assert.match(source, /shopling_title_diversification_ledger/);
  assert.match(source, /\.eq\("claim_run_id", runId\)/);
  assert.match(source, /\.eq\("status", "claimed"\)/);
  assert.match(source, /recoveredClaimRowCount/);
  assert.doesNotMatch(source, /password|cookie/i);
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

test("frame bridge still starts title work only for its own claimed goods keys", async () => {
  const source = await readFile(frameBridgePath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /PIPE_CLAIM_MESSAGE/);
  assert.match(source, /TITLE_BATCH_START_MESSAGE/);
  assert.match(source, /goodsKeys/);
  assert.match(source, /uiRun\.stage !== "title"/);
});

test("v0.5.5 unified stability bridge hands title completion to market without focus dependency", async () => {
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

test("v0.5.5 title supervisor uses chrome alarms and safe verify-first recovery after save", async () => {
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

test("title worker retains retry verification and durable item results", async () => {
  const source = await readFile(titleBackgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const PAGE_TIMEOUT_MS = 60000/);
  assert.match(source, /const MAX_AUTO_RETRIES = 2/);
  assert.match(source, /save_verify_duplicate/);
  assert.match(source, /itemResults/);
  assert.match(source, /LAST_RUN_STORAGE_KEY/);
});

test("title ledger migration still preserves baseline and explicit retry semantics", async () => {
  const source = await readFile(titleLedgerMigrationPath, "utf8");
  assert.match(source, /shopling_title_diversification_ledger/);
  assert.match(source, /primary key \(owner_id, goods_key\)/i);
  assert.match(source, /baseline_processed/);
  assert.match(source, /status = 'confirm_needed'/);
  assert.match(source, /retry_shopling_title_diversification_failures/);
  assert.match(source, /grant execute .* service_role/i);
});

test("market pipeline duplicate protections and claim recovery remain unchanged", async () => {
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

test("Shopling bridge v0.5.5 ZIP contains unified UI and persistent title supervisor", async () => {
  const source = await readFile(downloadRoutePath, "utf8");
  assert.ok(source.includes('"content-shopling-onebutton-stability-v055.js"'));
  assert.ok(source.includes('"background-shopling-title-supervisor-v055.js"'));
  assert.ok(source.includes('"background-shopling-pipeline.js"'));
  assert.ok(source.includes("commerce-os-shopling-account-title-bridge-v0.5.5.zip"));
  assert.ok(source.includes("Commerce OS Shopling Account Title Bridge v0.5.5"));
});

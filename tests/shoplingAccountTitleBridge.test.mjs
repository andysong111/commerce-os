import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL(
  "../public/shopling-account-title-bridge/manifest.json",
  import.meta.url,
);
const contentPath = new URL(
  "../public/shopling-account-title-bridge/content-shopling-account-titles.js",
  import.meta.url,
);
const listContentPath = new URL(
  "../public/shopling-account-title-bridge/content-shopling-product-list-batch.js",
  import.meta.url,
);
const marketContentPath = new URL(
  "../public/shopling-account-title-bridge/content-shopling-market-send.js",
  import.meta.url,
);
const backgroundPath = new URL(
  "../public/shopling-account-title-bridge/background-shopling-title-batch.js",
  import.meta.url,
);
const marketBackgroundPath = new URL(
  "../public/shopling-account-title-bridge/background-shopling-market-send.js",
  import.meta.url,
);
const backgroundRootPath = new URL(
  "../public/shopling-account-title-bridge/background-shopling-root.js",
  import.meta.url,
);
const backgroundSeoPath = new URL(
  "../public/shopling-account-title-bridge/background-shopling-seo-keywords.js",
  import.meta.url,
);
const downloadRoutePath = new URL(
  "../src/app/api/shopling-account-title-bridge/download/route.ts",
  import.meta.url,
);
const keywordPoolRoutePath = new URL(
  "../src/app/api/shopling-account-title-bridge/keyword-pool/route.ts",
  import.meta.url,
);
const keywordPoolLibPath = new URL(
  "../src/lib/shoplingTitleKeywordPool.ts",
  import.meta.url,
);

test("Shopling bridge v0.4.0 keeps title bridge and adds all-Shopling market content worker", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.4.0");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://a.shopling.co.kr/*",
    "https://commerce-os-ops-center.vercel.app/*",
  ]);
  assert.equal(manifest.background.service_worker, "background-shopling-root.js");
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://a.shopling.co.kr/prod/prodShopInfo.phtml*",
  ]);
  assert.deepEqual(manifest.content_scripts[1].matches, [
    "https://a.shopling.co.kr/prod/*",
  ]);
  assert.equal(manifest.content_scripts[1].all_frames, true);
  assert.deepEqual(manifest.content_scripts[2].matches, [
    "https://a.shopling.co.kr/*",
  ]);
  assert.equal(manifest.content_scripts[2].all_frames, true);
  assert.deepEqual(manifest.content_scripts[2].js, ["content-shopling-market-send.js"]);
});

test("mall-title bridge uses Shopling title tokens first and SEO master only as final fallback", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const MAX_TITLE_BYTES = 100/);
  assert.match(source, /buildVerifiedTokenPool/);
  assert.match(source, /SEO_KEYWORD_POOL_MESSAGE/);
  assert.match(source, /loadSeoMasterTokenPool/);
  assert.match(source, /seo_master_pool/);
  assert.match(source, /seo_keyword_pool_insufficient/);
  assert.match(source, /await applyDiversification\(retryAttempt\)/);
  assert.match(source, /button\.textContent = "분산·저장"/);
  assert.doesNotMatch(source, /button\.textContent = "미리 분산"/);
  assert.doesNotMatch(source, /button\.textContent = "분산 후 저장"/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("SEO keyword background worker omits Shopling credentials and uses only Commerce OS keyword-pool endpoint", async () => {
  const root = await readFile(backgroundRootPath, "utf8");
  const source = await readFile(backgroundSeoPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(root, /background-shopling-title-batch\.js/);
  assert.match(root, /background-shopling-seo-keywords\.js/);
  assert.match(root, /background-shopling-market-send\.js/);
  assert.match(source, /commerce-os-ops-center\.vercel\.app\/api\/shopling-account-title-bridge\/keyword-pool/);
  assert.match(source, /credentials: "omit"/);
  assert.match(source, /SEO_KEYWORD_POOL_TIMEOUT_MS = 8000/);
  assert.doesNotMatch(source, /a\.shopling\.co\.kr/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("keyword-pool API reads registry and latest SEO run but returns sanitized keywords only", async () => {
  const route = await readFile(keywordPoolRoutePath, "utf8");
  const helper = await readFile(keywordPoolLibPath, "utf8");
  assert.match(route, /shopling_product_group_registry/);
  assert.match(route, /seo_run_jobs/);
  assert.match(route, /buildShoplingTitleKeywordPool/);
  assert.match(route, /bridge !== BRIDGE_VERSION/);
  assert.match(route, /keywords,/);
  assert.doesNotMatch(route, /ptn_goods_cd|price|image|detail/i);
  assert.match(helper, /safetyPass === false/);
  assert.match(helper, /titleEligible === false/);
  assert.match(helper, /categoryAligned === false/);
  assert.match(helper, /blocked === true/);
  assert.match(helper, /prohibited === true/);
  assert.match(helper, /MAX_POOL_SIZE = 64/);
});

test("product-list title bridge preserves full-result safety and failure diagnostics", async () => {
  const source = await readFile(listContentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /총\\s\*조회수/);
  assert.match(source, /미분산 상품 일괄 처리/);
  assert.match(source, /collected\.expected > collected\.goodsKeys\.length/);
  assert.match(source, /LAST_RUN_STORAGE_KEY/);
  assert.match(source, /renderFailures/);
  assert.match(source, /자동복구/);
  assert.match(source, /goods key\/사유 보기/);
  assert.match(source, /credentials: "include"/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("market autosend content keeps fixed channel-profile mapping and fail-closed registration rules", async () => {
  const source = await readFile(marketContentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /\["DM1", "도매1"\]/);
  assert.match(source, /\["DM2", "도매2"\]/);
  assert.match(source, /\["DM3", "도매3"\]/);
  assert.match(source, /\["DM4", "도매4"\]/);
  assert.match(source, /\["SM1", "소매1"\]/);
  assert.match(source, /\["SM2", "소매2"\]/);
  assert.match(source, /goods_mallReg_idChoice/);
  assert.match(source, /goods_mallReg_preProdChoice/);
  assert.match(source, /쇼핑몰별\\s\*상품판매가/);
  assert.match(source, /쇼핑몰별\\s\*상품명/);
  assert.match(source, /rows\.length > 0 && rows\.length <= 12/);
  assert.match(source, /submit_result_ambiguous/);
  assert.match(source, /중복 재전송/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("background title coordinator keeps retry and persistent failure behavior", async () => {
  const source = await readFile(backgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const PAGE_TIMEOUT_MS = 60000/);
  assert.match(source, /const MAX_AUTO_RETRIES = 2/);
  assert.match(source, /retryOrFailCurrent/);
  assert.match(source, /save_verify_duplicate/);
  assert.match(source, /chrome\.storage\.session/);
  assert.match(source, /chrome\.storage\.local/);
  assert.match(source, /LAST_RUN_STORAGE_KEY/);
  assert.match(source, /autoRecovered/);
  assert.match(source, /active: false/);
  assert.match(source, /commerce_os_attempt/);
  assert.doesNotMatch(source, /password|cookie/i);
  assert.doesNotMatch(source, /https:\/\/(?!a\.shopling\.co\.kr)/);
});

test("market background coordinator uses exactly two lanes and never auto-retries after submit", async () => {
  const source = await readFile(marketBackgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const MARKET_MAX_LANES = 2/);
  assert.match(source, /const MARKET_MAX_AUTO_RETRIES = 1/);
  assert.match(source, /searchCode: "DM1", profile: "도매1"/);
  assert.match(source, /searchCode: "SM2", profile: "소매2"/);
  assert.match(source, /task\.stage !== "submitted"/);
  assert.match(source, /shopling_window_closed_after_submit/);
  assert.match(source, /submit_result_timeout/);
  assert.match(source, /chrome\.windows\.create/);
  assert.match(source, /chrome\.storage\.session/);
  assert.match(source, /chrome\.storage\.local/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("Shopling bridge v0.4.0 download ZIP includes market send workers", async () => {
  const source = await readFile(downloadRoutePath, "utf8");
  assert.ok(source.includes('"background-shopling-root.js"'));
  assert.ok(source.includes('"background-shopling-title-batch.js"'));
  assert.ok(source.includes('"background-shopling-seo-keywords.js"'));
  assert.ok(source.includes('"background-shopling-market-send.js"'));
  assert.ok(source.includes('"content-shopling-product-list-batch.js"'));
  assert.ok(source.includes('"content-shopling-market-send.js"'));
  assert.ok(source.includes('commerce-os-shopling-account-title-bridge-v0.4.0.zip'));
  assert.ok(source.includes('Commerce OS Shopling Account Title Bridge v0.4.0'));
  assert.doesNotMatch(
    source,
    /entries\[`commerce-os-shopling-account-title-bridge\/\$\{fileName\}`\]/,
  );
});

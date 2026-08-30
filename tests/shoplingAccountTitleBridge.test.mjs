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
const backgroundPath = new URL(
  "../public/shopling-account-title-bridge/background-shopling-title-batch.js",
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

test("Shopling bridge v0.3.1 keeps one-button list architecture and adds Commerce OS read-only host", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.3.1");
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

test("product-list bridge preserves full-result safety and failure diagnostics", async () => {
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

test("background coordinator keeps retry and persistent failure behavior", async () => {
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

test("Shopling bridge v0.3.1 download ZIP includes both background workers", async () => {
  const source = await readFile(downloadRoutePath, "utf8");
  assert.ok(source.includes('"background-shopling-root.js"'));
  assert.ok(source.includes('"background-shopling-title-batch.js"'));
  assert.ok(source.includes('"background-shopling-seo-keywords.js"'));
  assert.ok(source.includes('"content-shopling-product-list-batch.js"'));
  assert.ok(source.includes('commerce-os-shopling-account-title-bridge-v0.3.1.zip'));
  assert.ok(source.includes('Commerce OS Shopling Account Title Bridge v0.3.1'));
  assert.doesNotMatch(
    source,
    /entries\[`commerce-os-shopling-account-title-bridge\/\$\{fileName\}`\]/,
  );
});

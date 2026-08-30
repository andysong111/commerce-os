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
const downloadRoutePath = new URL(
  "../src/app/api/shopling-account-title-bridge/download/route.ts",
  import.meta.url,
);

test("Shopling bridge v0.3.0 keeps the one-button list-frame architecture", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.3.0");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://a.shopling.co.kr/*"]);
  assert.equal(manifest.background.service_worker, "background-shopling-title-batch.js");
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://a.shopling.co.kr/prod/prodShopInfo.phtml*",
  ]);
  assert.deepEqual(manifest.content_scripts[1].matches, [
    "https://a.shopling.co.kr/prod/*",
  ]);
  assert.equal(manifest.content_scripts[1].all_frames, true);
  assert.equal(manifest.content_scripts[1].match_about_blank, true);
});

test("mall-title bridge uses only verified same-goods-key title tokens as fallback", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const MAX_TITLE_BYTES = 100/);
  assert.match(source, /buildVerifiedTokenPool/);
  assert.match(source, /verified_pool/);
  assert.match(source, /verifiedPoolSize/);
  assert.match(source, /keyword_pool_insufficient/);
  assert.match(source, /commerce_os_attempt/);
  assert.match(source, /if \(!currentTitle \|\| utf8Bytes\(currentTitle\) > MAX_TITLE_BYTES\) continue/);
  assert.match(source, /button\.textContent = "분산·저장"/);
  assert.doesNotMatch(source, /button\.textContent = "미리 분산"/);
  assert.doesNotMatch(source, /button\.textContent = "분산 후 저장"/);
  assert.doesNotMatch(source, /commerce-os-ops-center\.vercel\.app/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("product-list bridge preserves full-result safety and renders failure diagnostics", async () => {
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

test("background coordinator retries transient failures and persists final item reasons", async () => {
  const source = await readFile(backgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const PAGE_TIMEOUT_MS = 60000/);
  assert.match(source, /const MAX_AUTO_RETRIES = 2/);
  assert.match(source, /retryOrFailCurrent/);
  assert.match(source, /save_verify_duplicate/);
  assert.match(source, /batch_timeout/);
  assert.match(source, /verify_timeout/);
  assert.match(source, /chrome\.storage\.session/);
  assert.match(source, /chrome\.storage\.local/);
  assert.match(source, /LAST_RUN_STORAGE_KEY/);
  assert.match(source, /failures: \[\]/);
  assert.match(source, /itemResults: \[\]/);
  assert.match(source, /autoRecovered/);
  assert.match(source, /active: false/);
  assert.match(source, /commerce_os_attempt/);
  assert.doesNotMatch(source, /password|cookie/i);
  assert.doesNotMatch(source, /https:\/\/(?!a\.shopling\.co\.kr)/);
});

test("Shopling bridge v0.3.0 download ZIP stays directly loadable", async () => {
  const source = await readFile(downloadRoutePath, "utf8");
  assert.ok(source.includes('"background-shopling-title-batch.js"'));
  assert.ok(source.includes('"content-shopling-product-list-batch.js"'));
  assert.ok(source.includes("entries[fileName] = new Uint8Array"));
  assert.ok(source.includes('entries["VERSION.txt"]'));
  assert.ok(source.includes('commerce-os-shopling-account-title-bridge-v0.3.0.zip'));
  assert.doesNotMatch(source, /content-shopling-save-guard\.js/);
  assert.doesNotMatch(
    source,
    /entries\[`commerce-os-shopling-account-title-bridge\/\$\{fileName\}`\]/,
  );
});

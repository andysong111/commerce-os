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
const backgroundPath = new URL(
  "../public/shopling-account-title-bridge/background-shopling-title-batch.js",
  import.meta.url,
);
const downloadRoutePath = new URL(
  "../src/app/api/shopling-account-title-bridge/download/route.ts",
  import.meta.url,
);

test("Shopling bridge v0.2.0 runs on product pages with a background coordinator", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.2.0");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://a.shopling.co.kr/*"]);
  assert.equal(
    manifest.background.service_worker,
    "background-shopling-title-batch.js",
  );
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://a.shopling.co.kr/prod/*",
  ]);
  assert.deepEqual(manifest.content_scripts[0].js, [
    "content-shopling-account-titles.js",
  ]);
});

test("Shopling page bridge exposes one action button and keeps blank rows untouched", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const MAX_TITLE_BYTES = 100/);
  assert.match(source, /if \(!currentTitle\) continue/);
  assert.match(source, /미분산 상품 일괄 처리/);
  assert.match(source, /분산·저장/);
  assert.doesNotMatch(source, /미리 분산/);
  assert.doesNotMatch(source, /분산 후 저장/);
  assert.match(source, /input\.dataset\.commerceOsOriginalTitle/);
  assert.match(source, /input\.dataset\.commerceOsDiversified = "1"/);
});

test("batch list scan only follows same-origin pagination and uses the logged-in Shopling session", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.match(source, /target\.origin !== base\.origin/);
  assert.match(source, /target\.pathname !== base\.pathname/);
  assert.match(source, /credentials: "include"/);
  assert.match(source, /MAX_LIST_PAGES = 30/);
  assert.match(source, /MAX_BATCH_GOODS_KEYS = 500/);
  assert.doesNotMatch(source, /commerce-os-ops-center\.vercel\.app/);
  assert.doesNotMatch(source, /password|document\.cookie/i);
});

test("background coordinator processes one hidden Shopling tab at a time and verifies after save", async () => {
  const source = await readFile(backgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /active: false/);
  assert.match(source, /commerce_os_batch/);
  assert.match(source, /commerce_os_verify/);
  assert.match(source, /chrome\.storage\.session/);
  assert.match(source, /await processNext\(\)/);
  assert.match(source, /outcome: message\.success \? "changed" : "failed"/);
  assert.doesNotMatch(source, /password|cookie/i);
  assert.doesNotMatch(source, /https:\/\/(?!a\.shopling\.co\.kr)/);
});

test("Shopling bridge download ZIP is directly loadable and includes the batch worker", async () => {
  const source = await readFile(downloadRoutePath, "utf8");
  assert.ok(source.includes('"background-shopling-title-batch.js"'));
  assert.ok(source.includes("entries[fileName] = new Uint8Array"));
  assert.ok(source.includes('entries["VERSION.txt"]'));
  assert.ok(source.includes('commerce-os-shopling-account-title-bridge-v0.2.0.zip'));
  assert.doesNotMatch(source, /content-shopling-save-guard\.js/);
  assert.doesNotMatch(
    source,
    /entries\[`commerce-os-shopling-account-title-bridge\/\$\{fileName\}`\]/,
  );
});

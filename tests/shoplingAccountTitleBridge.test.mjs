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
const saveGuardPath = new URL(
  "../public/shopling-account-title-bridge/content-shopling-save-guard.js",
  import.meta.url,
);
const downloadRoutePath = new URL(
  "../src/app/api/shopling-account-title-bridge/download/route.ts",
  import.meta.url,
);

test("Shopling account title bridge only receives the Shopling product-name page permission", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.1.1");
  assert.deepEqual(manifest.host_permissions, ["https://a.shopling.co.kr/*"]);
  assert.deepEqual(manifest.content_scripts[0].matches, [
    "https://a.shopling.co.kr/prod/prodShopInfo.phtml*",
  ]);
  assert.deepEqual(manifest.content_scripts[0].js, [
    "content-shopling-account-titles.js",
    "content-shopling-save-guard.js",
  ]);
});

test("Shopling bridge keeps blank rows untouched and does not add network or credential behavior", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /const MAX_TITLE_BYTES = 100/);
  assert.match(source, /if \(!currentTitle\) continue/);
  assert.match(source, /params\.get\("mode"\) !== "nm_chg"/);
  assert.match(source, /input\.dataset\.commerceOsOriginalTitle/);
  assert.match(source, /input\.dataset\.commerceOsDiversified = "1"/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|password|cookie/i);
});

test("Shopling bridge save guard only clicks the native save control after diversified inputs exist", async () => {
  const source = await readFile(saveGuardPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.ok(source.includes('input[data-commerce-os-diversified="1"]'));
  assert.match(source, /=== "저장"/);
  assert.match(source, /native\.click\(\)/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
});

test("Shopling bridge download ZIP puts manifest.json at the archive root", async () => {
  const source = await readFile(downloadRoutePath, "utf8");
  assert.ok(source.includes("entries[fileName] = new Uint8Array"));
  assert.ok(source.includes('entries["VERSION.txt"]'));
  assert.ok(source.includes('commerce-os-shopling-account-title-bridge-v0.1.1.zip'));
  assert.doesNotMatch(
    source,
    /entries\[`commerce-os-shopling-account-title-bridge\/\$\{fileName\}`\]/,
  );
});

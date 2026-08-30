import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL("../public/shopling-market-canary/manifest.json", import.meta.url);
const rootPath = new URL("../public/shopling-market-canary/background-root.js", import.meta.url);
const backgroundPath = new URL("../public/shopling-market-canary/background-market-canary.js", import.meta.url);
const contentPath = new URL("../public/shopling-market-canary/content-market-canary.js", import.meta.url);
const routePath = new URL("../src/app/api/shopling-account-title-bridge/pipeline/route.ts", import.meta.url);
const downloadPath = new URL("../src/app/api/shopling-market-canary/download/route.ts", import.meta.url);

test("market canary v0.1.3 stays standalone and declares Windows-safe script names", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.version, "0.1.3");
  assert.equal(manifest.name, "Commerce OS Shopling Market Canary");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.background.service_worker, "background-root.mjs");
  assert.deepEqual(manifest.content_scripts[0].js, ["content-market-canary.mjs"]);

  const root = await readFile(rootPath, "utf8");
  assert.doesNotThrow(() => new Function(root));
  assert.match(root, /background-market-canary\.js/);
  assert.doesNotMatch(root, /background-shopling-pipeline|title-batch|title-registry|seo-keywords/);
});

test("canary background supports claim, durable submit arm, and durable report", async () => {
  const source = await readFile(backgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /action: "canary-claim"/);
  assert.match(source, /action: "arm-submit"/);
  assert.match(source, /action: "report"/);
  assert.match(source, /CANARY_ARM_MESSAGE/);
  assert.match(source, /CANARY_REPORT_MESSAGE/);
  assert.match(source, /credentials: "omit"/);
});

test("canary follows the operator's real Shopling manual route and never creates its own Chrome window", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /쇼핑몰\\s\*미등록\\s\*검색/);
  assert.match(source, /쇼핑몰\\s\*상품등록/);
  assert.match(source, /goods_mallReg_idChoice/);
  assert.match(source, /goods_mallReg_preProdChoice/);
  assert.match(source, /savedProfileSelect/);
  assert.match(source, /상품등록송신/);
  assert.match(source, /쇼핑몰별 상품판매가/);
  assert.match(source, /쇼핑몰별 상품명/);
  assert.match(source, /매핑된 카테고리로 전송/);
  assert.doesNotMatch(source, /chrome\.windows\.create/);
  assert.doesNotMatch(source, /PIPE_MARKET_START_MESSAGE/);
});

test("canary arms Commerce OS durable submit lock before clicking Shopling send", async () => {
  const source = await readFile(contentPath, "utf8");
  const arm = source.indexOf("type: CANARY_ARM_MESSAGE");
  const send = source.indexOf("click(sendButton)");
  assert.ok(arm >= 0 && send > arm);
  assert.match(source, /submit_clicked/);
  assert.match(source, /confirm_needed/);
  assert.match(source, /다시 누르지 마세요/);
});

test("server canary still claims one wholesale1 row and releases only pre-submit failures", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /action === "canary-claim"/);
  assert.match(source, /product_group_key", "wholesale1"/);
  assert.match(source, /market_status", "pending"/);
  assert.match(source, /runId\.startsWith\(CANARY_RUN_PREFIX\) && outcome === "failed"/);
  assert.match(source, /\.is\("submit_armed_at", null\)/);
  assert.match(source, /status: "queued"/);
  assert.match(source, /canary_release_rejected/);
});

test("download ZIP is Windows Explorer friendly and contains no legacy .js payload names", async () => {
  const source = await readFile(downloadPath, "utf8");
  assert.match(source, /background-root\.mjs/);
  assert.match(source, /background-market-canary\.mjs/);
  assert.match(source, /content-market-canary\.mjs/);
  assert.match(source, /replace\(\/background-market-canary\\\.js\/g, "background-market-canary\.mjs"\)/);
  assert.match(source, /zipSync\(entries, \{ level: 0 \}\)/);
  assert.doesNotMatch(source, /\["background-root\.js",/);
  assert.doesNotMatch(source, /\["background-market-canary\.js",/);
  assert.doesNotMatch(source, /\["content-market-canary\.js",/);
  assert.match(source, /commerce-os-shopling-market-canary-v0\.1\.3\.zip/);
  assert.match(source, /Shopling Market Canary v0\.1\.3/);
});

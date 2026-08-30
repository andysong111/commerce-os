import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL("../public/shopling-market-canary/manifest.json", import.meta.url);
const rootPath = new URL("../public/shopling-market-canary/background-root.js", import.meta.url);
const claimPath = new URL("../public/shopling-market-canary/background-market-canary.js", import.meta.url);
const routerPath = new URL("../public/shopling-market-canary/content-canary-frame-router.js", import.meta.url);
const contentPath = new URL("../public/shopling-market-canary/content-market-canary.js", import.meta.url);
const pipelinePath = new URL("../public/shopling-account-title-bridge/content-shopling-pipeline.js", import.meta.url);
const routePath = new URL("../src/app/api/shopling-account-title-bridge/pipeline/route.ts", import.meta.url);
const downloadPath = new URL("../src/app/api/shopling-market-canary/download/route.ts", import.meta.url);

test("market canary package is isolated, DM1-only, and routes token before shared worker", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.version, "0.1.1");
  assert.equal(manifest.name, "Commerce OS Shopling Market Canary");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.content_scripts[0].js, [
    "content-canary-frame-router.js",
    "content-shopling-pipeline.js",
    "content-market-canary.js",
  ]);
});

test("canary frame router parks token on Shopling shell and passes it to actual worker frame", async () => {
  const source = await readFile(routerPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /CANARY_PREFIX = "commerce-os-canary-pipeline:"/);
  assert.match(source, /PIPE_PREFIX = "commerce-os-pipeline:"/);
  assert.match(source, /window\.top === window/);
  assert.match(source, /removeTokenFromVisibleUrl/);
  assert.match(source, /window\.top\?\.name/);
  assert.match(source, /goods_mallReg_idChoice/);
  assert.match(source, /goods_mallReg_preProdChoice/);
});

test("canary background loads only market pipeline plus canary claim bridge", async () => {
  const root = await readFile(rootPath, "utf8");
  assert.doesNotThrow(() => new Function(root));
  assert.match(root, /background-shopling-pipeline\.js/);
  assert.match(root, /background-market-canary\.js/);
  assert.doesNotMatch(root, /title-batch|title-registry|seo-keywords/);

  const claim = await readFile(claimPath, "utf8");
  assert.doesNotThrow(() => new Function(claim));
  assert.match(claim, /action: "canary-claim"/);
  assert.match(claim, /credentials: "omit"/);
});

test("canary UI starts exactly one DM1 to wholesale1 market task", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /DM1→도매1/);
  assert.match(source, /tasks: \[task\]/);
  assert.match(source, /task\.searchCode\) !== "DM1"/);
  assert.match(source, /task\.profile\) !== "도매1"/);
  assert.match(source, /PIPE_MARKET_START_MESSAGE/);
});

test("shared market worker retains exact-code and durable submit-lock protections", async () => {
  const source = await readFile(pipelinePath, "utf8");
  assert.match(source, /setInputValue\(searchInput, context\.ptnGoodsCd\)/);
  assert.match(source, /matchingRows\.length !== 1/);
  assert.match(source, /PIPE_MARKET_ARM_SUBMIT_MESSAGE/);
  const arm = source.indexOf("PIPE_MARKET_ARM_SUBMIT_MESSAGE");
  const click = source.indexOf("clickElement(sendButton)");
  assert.ok(arm >= 0 && click > arm);
});

test("server canary claims one wholesale1 row and only releases pre-submit failures", async () => {
  const source = await readFile(routePath, "utf8");
  assert.match(source, /action === "canary-claim"/);
  assert.match(source, /product_group_key", "wholesale1"/);
  assert.match(source, /market_status", "pending"/);
  assert.match(source, /runId\.startsWith\(CANARY_RUN_PREFIX\) && outcome === "failed"/);
  assert.match(source, /\.is\("submit_armed_at", null\)/);
  assert.match(source, /status: "queued"/);
  assert.match(source, /canary_release_rejected/);
});

test("download ZIP contains frame router plus canary and shared market worker files", async () => {
  const source = await readFile(downloadPath, "utf8");
  assert.match(source, /shopling-market-canary\/manifest\.json/);
  assert.match(source, /content-canary-frame-router\.js/);
  assert.match(source, /content-shopling-pipeline\.js/);
  assert.match(source, /background-shopling-pipeline\.js/);
  assert.match(source, /content-market-canary\.js/);
  assert.match(source, /background-market-canary\.js/);
  assert.doesNotMatch(source, /title-batch|title-registry|seo-keywords/);
  assert.match(source, /commerce-os-shopling-market-canary-v0\.1\.1\.zip/);
});

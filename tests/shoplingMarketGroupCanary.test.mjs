import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL("../public/shopling-market-group-canary/manifest.json", import.meta.url);
const backgroundPath = new URL("../public/shopling-market-group-canary/background-root.mjs", import.meta.url);
const contentPath = new URL("../public/shopling-market-group-canary/content-group-canary.mjs", import.meta.url);
const overlayPath = new URL("../public/shopling-market-group-canary/content-version-v031.mjs", import.meta.url);
const downloadPath = new URL("../src/app/api/shopling-market-group-canary/download/route.ts", import.meta.url);
const claimRoutePath = new URL("../src/app/api/shopling-market-group-canary/claim/route.ts", import.meta.url);

test("fresh worker canary v0.3.1 has persistent-launcher permissions", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.version, "0.3.1");
  assert.equal(manifest.name, "Commerce OS Shopling Market Fresh Worker Canary");
  assert.deepEqual(manifest.permissions, ["storage", "tabs", "windows", "scripting"]);
  assert.ok(manifest.host_permissions.includes("https://shopling.co.kr/*"));
  assert.ok(manifest.host_permissions.includes("*://*.shopling.co.kr/*"));
  assert.ok(manifest.content_scripts[0].js.includes("content-version-v031.mjs"));
  assert.equal(manifest.background.service_worker, "background-root.mjs");
});

test("fresh worker background is syntactically valid and never creates a replacement public launcher window", async () => {
  const source = await readFile(backgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.doesNotMatch(source, /chrome\.windows\.create/);
  assert.match(source, /findPersistentLauncherTab/);
  assert.match(source, /isPersistentLauncherUrl/);
  assert.match(source, /chrome\.tabs\.query/);
  assert.match(source, /chrome\.scripting\.executeScript/);
  assert.match(source, /persistent_shopling_launcher_missing/);
});

test("persistent launcher is never classified or closed as a disposable worker", async () => {
  const source = await readFile(backgroundPath, "utf8");
  assert.match(source, /openerTabId===meta\.launcherTabId/);
  assert.match(source, /launcherWindowId/);
  assert.match(source, /id!==meta\.launcherWindowId/);
  assert.match(source, /launcher:tabId===meta\.launcherTabId/);
});

test("manager access click is resolved from the existing logged-in launcher tab", async () => {
  const source = await readFile(backgroundPath, "utf8");
  assert.match(source, /clickManagerAccessOnLauncher/);
  assert.match(source, /관리자\\s\*접속/);
  assert.match(source, /target:\{tabId,allFrames:true\}/);
  assert.match(source, /waitingForAdminPopup:true/);
});

test("fresh worker content starts every admin popup at A18", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /commerceOsShoplingMarketFreshWorkerCanaryV030/);
  assert.match(source, /쇼핑몰\\s\*상품등록/);
  assert.match(source, /findA18Link/);
  assert.match(source, /stage: "worker_opening"/);
  assert.match(source, /openNextFreshWorker\(next\)/);
  assert.match(source, /1채널=1새창/);
});

test("v0.3.1 overlay is syntax-valid", async () => {
  const source = await readFile(overlayPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /DISPLAY_VERSION = "0\.3\.1"/);
});

test("fresh worker still requires goods key plus self-code in the same result row", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.match(source, /rowMatchesExactIdentity/);
  assert.match(source, /goodsKeyPattern/);
  assert.match(source, /codePattern\.test\(label\) && goodsKeyPattern\.test\(label\)/);
  assert.match(source, /exact_product_identity_ambiguous/);
});

test("fresh worker uses the field-tested Shopling popup route and saved profile twice", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.match(source, /goods_mallReg_idChoice/);
  assert.match(source, /goods_mallReg_preProdChoice/);
  assert.match(source, /savedProfileSelect\(task\.profile\)/);
  assert.match(source, /쇼핑몰별 상품판매가/);
});

test("fresh worker only confirms on the real result page after processing is finished", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.match(source, /prod_a\\\/prod_rgst_rspt/);
  assert.match(source, /isSubmitResultPage/);
  assert.match(source, /처리중입니다/);
  assert.match(source, /SUBMIT_CONFIRM_TIMEOUT_MS = 90000/);
});

test("fresh worker arms durable submit lock before Shopling send", async () => {
  const source = await readFile(contentPath, "utf8");
  const armIndex = source.indexOf("type: ARM_MESSAGE");
  const clickIndex = source.indexOf("click(sendButton)");
  assert.ok(armIndex >= 0 && clickIndex > armIndex);
  assert.match(source, /outcome: "confirm_needed"/);
});

test("partial claim endpoint accepts v0.3 run ids", async () => {
  const source = await readFile(claimRoutePath, "utf8");
  assert.match(source, /canary-group-v0\(\?:21\|30\)/);
  assert.match(source, /resumedPartialProduct: Boolean\(recentPartial\)/);
});

test("v0.3.1 ZIP syntax-checks exact scripts and rejects public-window creation", async () => {
  const source = await readFile(downloadPath, "utf8");
  assert.match(source, /const VERSION = "0\.3\.1"/);
  assert.match(source, /new Function\(source\)/);
  assert.match(source, /findPersistentLauncherTab/);
  assert.match(source, /chrome\.scripting\.executeScript/);
  assert.match(source, /must_not_create_public_launcher_window/);
  assert.match(source, /zipSync\(entries, \{ level: 0 \}\)/);
});

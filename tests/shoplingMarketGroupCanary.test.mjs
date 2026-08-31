import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestPath = new URL("../public/shopling-market-group-canary/manifest.json", import.meta.url);
const backgroundPath = new URL("../public/shopling-market-group-canary/background-root.mjs", import.meta.url);
const contentPath = new URL("../public/shopling-market-group-canary/content-group-canary.mjs", import.meta.url);
const overlayPath = new URL("../public/shopling-market-group-canary/content-version-v033.mjs", import.meta.url);
const downloadPath = new URL("../src/app/api/shopling-market-group-canary/download/route.ts", import.meta.url);
const claimRoutePath = new URL("../src/app/api/shopling-market-group-canary/claim/route.ts", import.meta.url);
const releaseRoutePath = new URL("../src/app/api/shopling-market-group-canary/release/route.ts", import.meta.url);

test("fresh worker v0.3.3 uses only A18 clone permissions", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.version, "0.3.3");
  assert.deepEqual(manifest.permissions, ["storage", "tabs", "windows"]);
  assert.ok(manifest.host_permissions.includes("*://*.shopling.co.kr/*"));
  assert.ok(manifest.content_scripts[0].js.includes("content-version-v033.mjs"));
  assert.ok(!manifest.permissions.includes("scripting"));
  assert.ok(!manifest.permissions.includes("contentSettings"));
});

test("background duplicates the original A18 control tab and adopts only the clone into a worker window", async () => {
  const source = await readFile(backgroundPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /chrome\.tabs\.duplicate\(controlTabId\)/);
  assert.match(source, /chrome\.windows\.create\(\{[\s\S]*tabId: duplicate\.id/);
  assert.match(source, /chrome\.tabs\.reload\(workerTabId\)/);
  assert.match(source, /a18CloneVerified: true/);
  assert.match(source, /controlTabId/);
  assert.match(source, /WORKER_META_KEY = "commerceOsShoplingFreshWorkerMetaV033"/);
});

test("v0.3.3 removes public launcher and synthetic 관리자접속 automation", async () => {
  const source = await readFile(backgroundPath, "utf8");
  assert.doesNotMatch(source, /clickManagerAccessOnLauncher/);
  assert.doesNotMatch(source, /findPersistentLauncherTab/);
  assert.doesNotMatch(source, /chrome\.scripting/);
  assert.doesNotMatch(source, /chrome\.contentSettings/);
  assert.doesNotMatch(source, /login_proc/);
  assert.doesNotMatch(source, /관리자접속/);
});

test("original A18 control window is excluded from disposable worker cleanup", async () => {
  const source = await readFile(backgroundPath, "utf8");
  assert.match(source, /id !== controlWindowId/);
  assert.match(source, /id !== meta\.controlWindowId/);
  assert.match(source, /control: tabId === meta\.controlTabId/);
});

test("clone preparation failures release pre-submit claims", async () => {
  const background = await readFile(backgroundPath, "utf8");
  const releaseRoute = await readFile(releaseRoutePath, "utf8");
  assert.match(background, /releaseRunBeforeSubmit/);
  assert.match(background, /a18_duplicate_failed/);
  assert.match(background, /a18_worker_not_ready/);
  assert.match(background, /group-canary-release-v0\.3\.2/);
  assert.match(releaseRoute, /\.eq\("claim_run_id", runId\)/);
  assert.match(releaseRoute, /\.eq\("status", "claimed"\)/);
  assert.match(releaseRoute, /\.eq\("market_status", "pending"\)/);
  assert.match(releaseRoute, /\.is\("submit_armed_at", null\)/);
  assert.match(releaseRoute, /status: "queued"/);
});

test("field-tested product selection and send guards remain intact", async () => {
  const source = await readFile(contentPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /rowMatchesExactIdentity/);
  assert.match(source, /codePattern\.test\(label\) && goodsKeyPattern\.test\(label\)/);
  assert.match(source, /goods_mallReg_idChoice/);
  assert.match(source, /goods_mallReg_preProdChoice/);
  assert.match(source, /savedProfileSelect\(task\.profile\)/);
  assert.match(source, /isSubmitResultPage/);
  assert.match(source, /SUBMIT_CONFIRM_TIMEOUT_MS = 90000/);
  const armIndex = source.indexOf("type: ARM_MESSAGE");
  const clickIndex = source.indexOf("click(sendButton)");
  assert.ok(armIndex >= 0 && clickIndex > armIndex);
});

test("v0.3.3 overlay is syntax-valid and describes A18 clone rotation", async () => {
  const source = await readFile(overlayPath, "utf8");
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /DISPLAY_VERSION = "0\.3\.3"/);
  assert.match(source, /원본 A18 유지/);
  assert.match(source, /A18 복제 작업창/);
});

test("partial claim endpoint still accepts the v0.3 run id used by the driver", async () => {
  const source = await readFile(claimRoutePath, "utf8");
  assert.match(source, /canary-group-v0\(\?:21\|30\)/);
  assert.match(source, /resumedPartialProduct: Boolean\(recentPartial\)/);
});

test("v0.3.3 download syntax-checks the exact A18 clone package", async () => {
  const source = await readFile(downloadPath, "utf8");
  assert.match(source, /const VERSION = "0\.3\.3"/);
  assert.match(source, /new Function\(source\)/);
  assert.match(source, /a18_duplicate_missing/);
  assert.match(source, /duplicate_window_adoption_missing/);
  assert.match(source, /obsolete_manager_launcher_present/);
  assert.match(source, /obsolete_popup_logic_present/);
  assert.match(source, /zipSync\(entries, \{ level: 0 \}\)/);
});

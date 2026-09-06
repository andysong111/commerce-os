import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = "public/shopling-stock-state-sync";
const jsFiles = [
  "background-v013.js",
  "content-ops-v013.js",
  "main-shopling.js",
  "menu-guard-v014.js",
  "menu-main-click-v015.js",
  "a6-role-marker-v016.js",
  "content-shopling-v018.js",
  "popup.js",
];

test("stock-state extension v0.1.8 is Manifest V3 and excludes debugger", async () => {
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.1.8");
  assert.equal(manifest.background.service_worker, "background-v013.js");
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.ok(manifest.permissions.includes("webNavigation"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(!manifest.permissions.includes("debugger"));
});

test("all shipped v0.1.8 JavaScript parses", async () => {
  for (const fileName of jsFiles) {
    const source = await readFile(`${root}/${fileName}`, "utf8");
    assert.doesNotThrow(() => new Function(source), fileName);
  }
});

test("v0.1.8 keeps same-job stale RUNNING recovery", async () => {
  const ops = await readFile(`${root}/content-ops-v013.js`, "utf8");
  assert.match(ops, /const VERSION = "0\.1\.8"/);
  assert.match(ops, /commerceOsShoplingStockStateSyncV013/);
  assert.match(ops, /staleTerminalRunning/);
  assert.match(ops, /String\(active\.job\.jobId\) === String\(lastResult\.jobId\)/);
  assert.match(ops, /lastFinishedAt >= activeStartedAt/);
  assert.match(ops, /\["SUCCEEDED", "FAILED", "UNCERTAIN"\]/);
  assert.match(ops, /chrome\.storage\.local\.remove\(STATE_KEY\)/);
  assert.doesNotMatch(ops, /STOCK_SYNC_STOP/);
});

test("route contract remains option A6->A21 option send and single A4->A21 sale-status", async () => {
  const background = await readFile(`${root}/background-v013.js`, "utf8");
  const content = await readFile(`${root}/content-shopling-v018.js`, "utf8");
  assert.match(background, /firstStage = normalized\.job\.productKind === "OPTION" \? "A6" : "A4"/);
  assert.match(content, /A21_OPTION_SEND_MODE_NOT_FOUND/);
  assert.match(content, /A21_SALE_STATUS_MODE_NOT_FOUND/);
  assert.match(content, /runA4/);
  assert.match(content, /runA6/);
  assert.doesNotMatch(content, /runA22/);
});

test("jobs require goods key and multiple goods keys are serialized", async () => {
  const background = await readFile(`${root}/background-v013.js`, "utf8");
  assert.match(background, /STOCK_SYNC_GOODS_KEY_REQUIRED/);
  assert.match(background, /goodsKeyIndex/);
  assert.match(background, /continueNextGoodsKey/);
});

test("menu MAIN-world bridge and A6 role marker run before the v0.1.8 Shopling worker", async () => {
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  const shopling = manifest.content_scripts.find((entry) => entry.js?.includes("content-shopling-v018.js"));
  assert.deepEqual(shopling?.js, [
    "menu-guard-v014.js",
    "menu-main-click-v015.js",
    "a6-role-marker-v016.js",
    "content-shopling-v018.js",
  ]);
});

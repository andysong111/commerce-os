import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = "public/shopling-stock-state-sync";
const jsFiles = [
  "background-v020.js",
  "content-ops-v020.js",
  "main-shopling.js",
  "menu-guard-v014.js",
  "menu-main-click-v015.js",
  "a6-role-marker-v016.js",
  "content-shopling-v018.js",
  "popup.js",
];

test("stock-state extension v0.2.0 is Manifest V3 and excludes debugger", async () => {
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.2.0");
  assert.equal(manifest.background.service_worker, "background-v020.js");
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.ok(manifest.permissions.includes("webNavigation"));
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(!manifest.permissions.includes("debugger"));
});

test("all shipped v0.2.0 JavaScript parses", async () => {
  for (const fileName of jsFiles) {
    const source = await readFile(`${root}/${fileName}`, "utf8");
    assert.doesNotThrow(() => new Function(source), fileName);
  }
});

test("v0.2.0 uses fixed A4/A6/A21 tabs instead of home bootstrap", async () => {
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  const shopling = manifest.content_scripts.find((entry) => entry.js?.includes("content-shopling-v018.js"));
  assert.deepEqual(shopling?.js, [
    "menu-guard-v014.js",
    "menu-main-click-v015.js",
    "a6-role-marker-v016.js",
    "content-shopling-v018.js",
  ]);
  assert.ok(!shopling?.js?.includes("home-bootstrap-v019.js"));
  const background = await readFile(`${root}/background-v020.js`, "utf8");
  assert.match(background, /requiredStages\(productKind\)/);
  assert.match(background, /SHOPLING_REQUIRED_WORK_TAB_MISSING/);
  assert.match(background, /findExactRoleTarget/);
  assert.match(background, /page\.role !== expectedRole\(active\.stage\)/);
  assert.match(background, /PRE_SUBMIT_TIMEOUT_MS = 60_000/);
});

test("fixed-tab preflight prevents half-execution", async () => {
  const background = await readFile(`${root}/background-v020.js`, "utf8");
  assert.match(background, /productKind === "OPTION" \? \["A6", "A21_LIST"\] : \["A4", "A21_LIST"\]/);
  assert.match(background, /const preflight = await preflightWorkTabs\(normalized\.job\)/);
  assert.match(background, /if \(!preflight\.ok\) return preflight/);
  assert.match(background, /SHOPLING_REQUIRED_WORK_TAB_LOST_AFTER_MUTATION/);
});

test("route remains option A6 to A21 and single A4 to A21", async () => {
  const background = await readFile(`${root}/background-v020.js`, "utf8");
  const content = await readFile(`${root}/content-shopling-v018.js`, "utf8");
  assert.match(background, /firstStage = normalized\.job\.productKind === "OPTION" \? "A6" : "A4"/);
  assert.match(content, /A21_OPTION_SEND_MODE_NOT_FOUND/);
  assert.match(content, /A21_SALE_STATUS_MODE_NOT_FOUND/);
  assert.doesNotMatch(content, /runA22/);
});

test("v0.2.0 ops handshake keeps same-job stale RUNNING recovery", async () => {
  const ops = await readFile(`${root}/content-ops-v020.js`, "utf8");
  assert.match(ops, /const VERSION = "0\.2\.0"/);
  assert.match(ops, /staleTerminalRunning/);
  assert.match(ops, /lastFinishedAt >= activeStartedAt/);
  assert.match(ops, /chrome\.storage\.local\.remove\(STATE_KEY\)/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = "public/shopling-stock-state-sync";

test("v0.2.1 package uses fixed Shopling work tabs with price-engine overlay", async () => {
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  assert.equal(manifest.version, "0.2.1");
  assert.equal(manifest.background.service_worker, "background-v021.js");
  assert.ok(!manifest.permissions.includes("debugger"));
  const shopling = manifest.content_scripts.find((entry) =>
    entry.matches?.includes("https://a.shopling.co.kr/*") && entry.js?.includes("content-shopling-v018.js"),
  );
  assert.ok(shopling);
  assert.ok(!shopling.js.includes("home-bootstrap-v019.js"));
  assert.equal(shopling.all_frames, true);
});

test("price-extension proven mechanics are reused before stock worker dispatch", async () => {
  const overlay = await readFile(`${root}/background-v021.js`, "utf8");
  assert.match(overlay, /executeAllFramesV021/);
  assert.match(overlay, /allFrames: true/);
  assert.match(overlay, /identifyFramesV021/);
  assert.match(overlay, /chrome\.tabs\.reload/);
  assert.match(overlay, /chrome\.scripting\.executeScript/);
  assert.match(overlay, /ensureWorkerV021/);
  assert.match(overlay, /content-shopling-v018\.js/);
});

test("option products use fixed A6 then fixed A21 option send and never A22", async () => {
  const background = await readFile(`${root}/background-v020.js`, "utf8");
  const content = await readFile(`${root}/content-shopling-v018.js`, "utf8");
  assert.match(background, /\["A6", "A21_LIST"\]/);
  assert.match(background, /고정 A21 탭.*옵션송신/);
  assert.match(content, /A21_OPTION_SEND_MODE_NOT_FOUND/);
  assert.doesNotMatch(background, /A22/);
  assert.doesNotMatch(content, /runA22/);
});

test("single products use fixed A4 then A21 sale-status send", async () => {
  const background = await readFile(`${root}/background-v020.js`, "utf8");
  const content = await readFile(`${root}/content-shopling-v018.js`, "utf8");
  assert.match(background, /\["A4", "A21_LIST"\]/);
  assert.match(content, /runA4/);
  assert.match(content, /상품판매상태송신/);
});

test("A4/A21 retain exact goods-key and one-row safety", async () => {
  const background = await readFile(`${root}/background-v020.js`, "utf8");
  const content = await readFile(`${root}/content-shopling-v018.js`, "utf8");
  assert.match(background, /STOCK_SYNC_GOODS_KEY_REQUIRED/);
  assert.match(content, /searchGoodsKey/);
  assert.match(content, /샵플링상품코드/);
  assert.match(content, /A4_EXACT_ROW_SELECTION_FAILED/);
  assert.match(content, /A21_EXACT_ROW_SELECTION_FAILED/);
  assert.match(content, /selected\.count !== 1/);
});

test("A6 search worker keeps legacy input recovery", async () => {
  const content = await readFile(`${root}/content-shopling-v018.js`, "utf8");
  assert.match(content, /function editableSearchInputs/);
  assert.match(content, /querySelectorAll\("input,textarea"\)/);
  assert.match(content, /6_000, 120/);
  assert.match(content, /SEARCH_INPUT_SET_FAILED/);
  assert.match(content, /searchInputDiagnostics/);
});

test("timeouts remain fail-closed and fast before submit", async () => {
  const background = await readFile(`${root}/background-v020.js`, "utf8");
  assert.match(background, /PRE_SUBMIT_TIMEOUT_MS = 60_000/);
  assert.match(background, /submitted \? "UNCERTAIN" : "FAILED"/);
  assert.match(background, /failureCount/);
  assert.match(background, /STOCK_SYNC_OPPOSITE_JOB_BLOCKED/);
});

test("download route packages v0.2.1 price-engine overlay without home bootstrap", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  assert.match(route, /const VERSION = "0\.2\.1"/);
  for (const file of ["background-v020.js", "background-v021.js", "content-ops-v021.js", "content-shopling-v018.js"]) {
    assert.match(route, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(route, /"home-bootstrap-v019\.js",/);
  assert.match(route, /shopling_stock_state_debugger_forbidden/);
});

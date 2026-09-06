import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = "public/shopling-stock-state-sync";

test("v0.2.0 package uses fixed Shopling work tabs", async () => {
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  assert.equal(manifest.version, "0.2.0");
  assert.equal(manifest.background.service_worker, "background-v020.js");
  assert.ok(!manifest.permissions.includes("debugger"));
  const shopling = manifest.content_scripts.find((entry) =>
    entry.matches?.includes("https://a.shopling.co.kr/*") && entry.js?.includes("content-shopling-v018.js"),
  );
  assert.ok(shopling);
  assert.ok(!shopling.js.includes("home-bootstrap-v019.js"));
  assert.equal(shopling.all_frames, true);
});

test("option products use fixed A6 then fixed A21 option send and never A22", async () => {
  const background = await readFile(`${root}/background-v020.js`, "utf8");
  const content = await readFile(`${root}/content-shopling-v018.js`, "utf8");
  const readme = await readFile(`${root}/README.txt`, "utf8");
  assert.match(background, /\["A6", "A21_LIST"\]/);
  assert.match(background, /고정 A21 탭.*옵션송신/);
  assert.match(content, /A21_OPTION_SEND_MODE_NOT_FOUND/);
  assert.doesNotMatch(background, /A22/);
  assert.doesNotMatch(content, /runA22/);
  assert.match(readme, /A22 쇼핑몰상품옵션전송은 사용하지 않습니다/);
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

test("fixed-tab router only dispatches exact stage roles", async () => {
  const background = await readFile(`${root}/background-v020.js`, "utf8");
  assert.match(background, /response\?\.page\?\.role !== expected/);
  assert.match(background, /response && response\.ignored !== true/);
  assert.match(background, /SHOPLING_FIXED_TAB_ROLE_MISMATCH/);
  assert.match(background, /SHOPLING_REQUIRED_WORK_TAB_MISSING/);
});

test("timeouts remain fail-closed and fast before submit", async () => {
  const background = await readFile(`${root}/background-v020.js`, "utf8");
  assert.match(background, /PRE_SUBMIT_TIMEOUT_MS = 60_000/);
  assert.match(background, /submitted \? "UNCERTAIN" : "FAILED"/);
  assert.match(background, /failureCount/);
  assert.match(background, /STOCK_SYNC_OPPOSITE_JOB_BLOCKED/);
});

test("download route packages v0.2.0 without home bootstrap", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  assert.match(route, /const VERSION = "0\.2\.0"/);
  for (const file of ["background-v020.js", "content-ops-v020.js", "content-shopling-v018.js"]) {
    assert.match(route, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(route, /"home-bootstrap-v019\.js",/);
  assert.match(route, /shopling_stock_state_debugger_forbidden/);
});

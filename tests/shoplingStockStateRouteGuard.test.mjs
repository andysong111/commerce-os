import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = "public/shopling-stock-state-sync";

test("v0.1.5 package keeps A4/A6/A21 worker and adds the real-A6 role marker before the worker", async () => {
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  assert.equal(manifest.version, "0.1.5");
  assert.equal(manifest.background.service_worker, "background-v013.js");
  assert.ok(!manifest.permissions.includes("debugger"));
  const shopling = manifest.content_scripts.find((entry) =>
    entry.matches?.includes("https://a.shopling.co.kr/*") &&
    entry.js?.includes("content-shopling-v013.js"),
  );
  assert.deepEqual(shopling?.js, ["menu-guard-v014.js", "a6-role-marker-v015.js", "content-shopling-v013.js"]);
  assert.equal(shopling?.all_frames, true);
});

test("option products still use A6 then A21 goods-key option send and never A22", async () => {
  const background = await readFile(`${root}/background-v013.js`, "utf8");
  const content = await readFile(`${root}/content-shopling-v013.js`, "utf8");
  const readme = await readFile(`${root}/README.txt`, "utf8");
  assert.match(background, /productKind === "OPTION" \? "A6" : "A4"/);
  assert.match(background, /A21 goods key .*옵션송신/);
  assert.match(content, /A21_OPTION_SEND_MODE_NOT_FOUND/);
  assert.match(content, /상품옵션/);
  assert.doesNotMatch(background, /A22/);
  assert.doesNotMatch(content, /runA22/);
  assert.match(readme, /A22 쇼핑몰상품옵션전송은 더 이상 이 자동화 경로에서 사용하지 않습니다/);
});

test("single products still use A4 product status then A21 product sale-status transmission", async () => {
  const background = await readFile(`${root}/background-v013.js`, "utf8");
  const content = await readFile(`${root}/content-shopling-v013.js`, "utf8");
  assert.match(background, /active\.job\.productKind === "OPTION" \? "A21_LIST" : "A4"/);
  assert.match(content, /runA4/);
  assert.match(content, /A4_PRODUCT_STATUS_CONTROL_NOT_FOUND/);
  assert.match(content, /상품판매상태송신/);
  assert.match(content, /A21_TARGET_STATUS_NOT_FOUND/);
});

test("A4/A21 require exact numeric goods key and exact one-row selection", async () => {
  const background = await readFile(`${root}/background-v013.js`, "utf8");
  const content = await readFile(`${root}/content-shopling-v013.js`, "utf8");
  assert.match(background, /STOCK_SYNC_GOODS_KEY_REQUIRED/);
  assert.match(content, /searchGoodsKey/);
  assert.match(content, /A4_EXACT_ROW_SELECTION_FAILED/);
  assert.match(content, /A21_EXACT_ROW_SELECTION_FAILED/);
  assert.match(content, /selected\.count !== 1/);
});

test("v0.1.4 guard no longer rewrites querySelectorAll and therefore cannot hide the real [6] option bulk menu", async () => {
  const guard = await readFile(`${root}/menu-guard-v014.js`, "utf8");
  const content = await readFile(`${root}/content-shopling-v013.js`, "utf8");
  assert.doesNotMatch(guard, /querySelectorAll\s*=/);
  assert.doesNotMatch(guard, /commerceOsSafeQuerySelectorAll/);
  assert.match(guard, /SHOPLING_PERMISSION_DENIED/);
  assert.match(content, /옵션대량수정/);
  assert.match(content, /상품조회수정/);
  assert.match(content, /쇼핑몰상품수정/);
  assert.match(content, /document\.querySelectorAll\("a,\[onclick\],li,td,span,div"\)/);
});

test("v0.1.5 marks only the real A6 work frame so pre-search A6 is recognized without misclassifying the menu frame", async () => {
  const marker = await readFile(`${root}/a6-role-marker-v015.js`, "utf8");
  assert.match(marker, /옵션대량수정/);
  assert.match(marker, /옵션수량변경/);
  assert.match(marker, /검색항목/);
  assert.match(marker, /일괄 상태변경/);
  assert.match(marker, /aria-hidden/);
  assert.match(marker, /left = "-100000px"/);
});

test("timeout and failed-result rules remain fail-closed", async () => {
  const background = await readFile(`${root}/background-v013.js`, "utf8");
  assert.match(background, /submitted \? "UNCERTAIN" : "FAILED"/);
  assert.match(background, /failureCount/);
  assert.match(background, /STOCK_SYNC_OPPOSITE_JOB_BLOCKED/);
  assert.doesNotMatch(background, /RESULT_TIMEOUT[\s\S]{0,160}SUCCEEDED/);
});

test("download route packages v0.1.5 A6 marker with the reviewed stock-state worker files", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  assert.match(route, /const VERSION = "0\.1\.5"/);
  for (const file of [
    "background-v013.js",
    "content-ops-v013.js",
    "menu-guard-v014.js",
    "a6-role-marker-v015.js",
    "content-shopling-v013.js",
  ]) {
    assert.match(route, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(route, /shopling_stock_state_debugger_forbidden/);
});

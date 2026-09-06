import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = "public/shopling-stock-state-sync";

test("v0.1.3 package uses A4/A6/A21 guarded route files", async () => {
  const manifest = JSON.parse(await readFile(`${root}/manifest.json`, "utf8"));
  assert.equal(manifest.version, "0.1.3");
  assert.equal(manifest.background.service_worker, "background-v013.js");
  assert.ok(!manifest.permissions.includes("debugger"));
  const shopling = manifest.content_scripts.find((entry) =>
    entry.matches?.includes("https://a.shopling.co.kr/*") &&
    entry.js?.includes("content-shopling-v013.js"),
  );
  assert.deepEqual(shopling?.js, ["menu-guard-v013.js", "content-shopling-v013.js"]);
  assert.equal(shopling?.all_frames, true);
});

test("option products no longer use A22 and instead use A6 then A21 goods-key option send", async () => {
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

test("single products use A4 product status then A21 product sale-status transmission", async () => {
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

test("menu guard recognizes only exact A4, A6 and A21 labels and keeps old bad A6 route blocked", async () => {
  const guard = await readFile(`${root}/menu-guard-v013.js`, "utf8");
  assert.match(guard, /상품조회수정/);
  assert.match(guard, /옵션대량수정/);
  assert.match(guard, /쇼핑몰상품수정/);
  assert.match(guard, /prodBulkOptLst/);
  assert.doesNotMatch(guard, /쇼핑몰상품옵션전송/);
});

test("timeout and failed-result rules remain fail-closed", async () => {
  const background = await readFile(`${root}/background-v013.js`, "utf8");
  assert.match(background, /submitted \? "UNCERTAIN" : "FAILED"/);
  assert.match(background, /failureCount/);
  assert.match(background, /STOCK_SYNC_OPPOSITE_JOB_BLOCKED/);
  assert.doesNotMatch(background, /RESULT_TIMEOUT[\s\S]{0,160}SUCCEEDED/);
});

test("download route packages only v0.1.3 reviewed files", async () => {
  const route = await readFile("src/app/api/shopling-stock-state-sync/download/route.ts", "utf8");
  assert.match(route, /const VERSION = "0\.1\.3"/);
  for (const file of [
    "background-v013.js",
    "content-ops-v013.js",
    "menu-guard-v013.js",
    "content-shopling-v013.js",
  ]) {
    assert.match(route, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(route, /shopling_stock_state_debugger_forbidden/);
});

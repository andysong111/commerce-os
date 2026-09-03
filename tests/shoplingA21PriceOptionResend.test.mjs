import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainSubmitBridge, backgroundBase, backgroundV041, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v041.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.4.1 uses Chrome debugger CDP instead of static result content scripts", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.4.1");
  assert.equal(manifest.background.service_worker, "background-v041.js");
  assert.ok(manifest.permissions.includes("debugger"));
  assert.ok(!manifest.content_scripts.some((row) => row.js?.some((name) => name.includes("result-watch"))));
  assert.match(backgroundV041, /chrome\.debugger\.attach/);
  assert.match(backgroundV041, /Runtime\.enable/);
  assert.match(backgroundV041, /Runtime\.evaluate/);
});

test("A21 v0.4.1 reads processing state and completion evidence from the actual result contexts", () => {
  assert.match(backgroundV041, /처리중입니다/);
  assert.match(backgroundV041, /잠시만\\s\*기다려주시기\\s\*바랍니다/);
  assert.match(backgroundV041, /상품\\s\*수정\\s\*전송이\\s\*완료되었습니다/);
  assert.match(backgroundV041, /window\.scrollTo/);
  assert.match(backgroundV041, /executionContextCreated/);
  assert.match(backgroundV041, /STABLE_MS = 1_800/);
  assert.match(backgroundV041, /completeJob/);
  assert.match(backgroundV041, /V041_CDP_RESULT_TIMEOUT/);
  assert.match(popupRunHtml, /v0\.4\.1/);
  assert.match(popupRun, /debugger\(CDP\)/);
});

test("A21 v0.4.1 correlates candidate result tabs with current worker and popup", () => {
  assert.match(backgroundV041, /candidateTabs/);
  assert.match(backgroundV041, /openerTabId/);
  assert.match(backgroundV041, /popupTabId/);
  assert.match(backgroundV041, /workerTabId/);
  assert.match(backgroundV041, /createdTabs/);
});

test("A21 v0.4.1 preserves price-first serial queue", () => {
  assert.match(backgroundV041, /job\.status === "QUEUED" && job\.mode === "PRICE"/);
  assert.match(backgroundV041, /job\.status === "QUEUED" && job\.mode === "OPTION"/);
  assert.match(backgroundV041, /sortJobsPricesFirst/);
  assert.match(backgroundV041, /state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)/);
});

test("A21 v0.4.1 preserves delivery and form safety before submit", () => {
  for (const source of [exactPopup, mainSubmitBridge]) {
    assert.match(source, /trsmt_env_mody_dlvyinfo/);
    assert.match(source, /수정\\s\*안함|수정안함/);
    assert.match(source, /forceDeliveryUnchanged/);
  }
  assert.match(exactPopup, /tsmt_sale_price_tp/);
  assert.match(exactPopup, /trsmt_env_mody_price/);
  assert.match(exactPopup, /goods_stock/);
  assert.match(exactPopup, /trsmt_env_mody_opt/);
  assert.match(mainSubmitBridge, /window\.goods_mallMdfy_submit_sp\(\)/);
});

test("A21 v0.4.1 does not gate progress on per-market success or A21 final-send date", () => {
  assert.match(backgroundV041, /마켓별 결과 검증 없음/);
  assert.doesNotMatch(backgroundV041, /finalSendBaseline|최종전송일/);
  assert.doesNotMatch(backgroundV041, /failure > 0|성공여부.*FAILED/);
});

test("A21 resend plan still requires verified Shopling stored prices before transmission", () => {
  for (const needle of [
    'readback.state === "VERIFIED"',
    "readback.verifiedGoodsKeyCount === plan.goodsKeyCount",
    "readback.failedGoodsKeyCount === 0",
    "readback.mallMismatchCount === 0",
    "readback.mallMissingCount === 0",
    "readback.mallMatchCount === readback.mallCheckCount",
  ]) assert.ok(planRoute.includes(needle), `missing ${needle}`);
  assert.match(downloadRoute, /const VERSION = "0\.4\.1"/);
  assert.match(downloadRoute, /background-v041\.js/);
  assert.match(downloadRoute, /debugger/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

test("A21 v0.4.1 keeps base worker serial safety", () => {
  assert.match(backgroundBase, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
});

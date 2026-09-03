import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainSubmitBridge, backgroundBase, backgroundV040, resultWatch, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v040.js", root), "utf8"),
  readFile(new URL("result-watch-v040.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.4.0 injects a result observer into Shopling and about:blank descendants", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.4.0");
  assert.equal(manifest.background.service_worker, "background-v040.js");
  assert.ok(!manifest.permissions.includes("webRequest"));
  const resultRuntime = manifest.content_scripts.find((row) => row.js?.includes("result-watch-v040.js"));
  assert.ok(resultRuntime);
  assert.equal(resultRuntime.all_frames, true);
  assert.equal(resultRuntime.match_about_blank, true);
  assert.equal(resultRuntime.match_origin_as_fallback, true);
  assert.equal(resultRuntime.run_at, "document_start");
});

test("A21 v0.4.0 result document reports visible loading and footer directly", () => {
  assert.match(resultWatch, /처리중입니다/);
  assert.match(resultWatch, /잠시만\\s\*기다려주시기\\s\*바랍니다/);
  assert.match(resultWatch, /상품\\s\*수정\\s\*전송이\\s\*완료되었습니다/);
  assert.match(resultWatch, /scrollResultToBottom/);
  assert.match(resultWatch, /A21_RESULT_STATUS_V040/);
  assert.match(backgroundV040, /resultSawProcessing/);
  assert.match(backgroundV040, /anyFooter/);
  assert.match(backgroundV040, /STABLE_MS = 1_800/);
  assert.match(backgroundV040, /completeJob/);
  assert.match(backgroundV040, /V040_RESULT_DOCUMENT_TIMEOUT/);
  assert.match(popupRunHtml, /v0\.4\.0/);
  assert.match(popupRun, /about:blank/);
});

test("A21 v0.4.0 correlates result sender with the current popup or worker", () => {
  assert.match(backgroundV040, /senderRelatedToJob/);
  assert.match(backgroundV040, /openerTabId/);
  assert.match(backgroundV040, /popupTabId/);
  assert.match(backgroundV040, /workerTabId/);
  assert.match(backgroundV040, /resultWindowId/);
});

test("A21 v0.4.0 preserves price-first serial queue", () => {
  assert.match(backgroundV040, /job\.status === "QUEUED" && job\.mode === "PRICE"/);
  assert.match(backgroundV040, /job\.status === "QUEUED" && job\.mode === "OPTION"/);
  assert.match(backgroundV040, /sortJobsPricesFirstV040/);
  assert.match(backgroundV040, /state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)/);
});

test("A21 v0.4.0 preserves delivery and form safety before submit", () => {
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

test("A21 v0.4.0 does not gate progress on per-market success results or final-send date", () => {
  assert.match(backgroundV040, /마켓별 결과 검증 없음/);
  assert.doesNotMatch(backgroundV040, /finalSendBaseline|최종전송일/);
  assert.doesNotMatch(backgroundV040, /failure > 0|성공여부.*FAILED/);
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
  assert.match(downloadRoute, /const VERSION = "0\.4\.0"/);
  assert.match(downloadRoute, /background-v040\.js/);
  assert.match(downloadRoute, /result-watch-v040\.js/);
  assert.match(downloadRoute, /match_about_blank/);
  assert.match(downloadRoute, /match_origin_as_fallback/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

test("A21 v0.4.0 keeps base worker serial safety", () => {
  assert.match(backgroundBase, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
});

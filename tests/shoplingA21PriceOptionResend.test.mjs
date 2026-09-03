import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainSubmitBridge, backgroundBase, backgroundV039, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v039.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.3.9 uses A21 final transmission date readback instead of result popup loading", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.3.9");
  assert.equal(manifest.background.service_worker, "background-v039.js");
  assert.ok(!manifest.permissions.includes("webRequest"));
  assert.match(backgroundV039, /최종\\s\*전송일|최종전송일/);
  assert.match(backgroundV039, /readFinalTransmissionRows/);
  assert.match(backgroundV039, /refreshWorkerSearch/);
  assert.match(backgroundV039, /finalSendBaseline/);
  assert.match(backgroundV039, /submitAckAt/);
  assert.ok(!manifest.content_scripts.some((row) => row.js?.some((name) => /result-(loading|bridge|relay|complete|wait)/.test(name))));
});

test("A21 v0.3.9 requires every target GOODSKEY final-send timestamp to update before advancing", () => {
  assert.match(backgroundV039, /status\.pending\.length === 0/);
  assert.match(backgroundV039, /status\.updated\.length === job\.goodsKeys\.length/);
  assert.match(backgroundV039, /READBACK_STABLE_MS = 1_800/);
  assert.match(backgroundV039, /completeJob/);
  assert.match(backgroundV039, /V039_FINAL_SEND_READBACK_TIMEOUT/);
  assert.match(popupRunHtml, /v0\.3\.9/);
  assert.match(popupRun, /최종전송일/);
});

test("A21 v0.3.9 preserves price-first serial queue", () => {
  assert.match(backgroundV039, /job\.status === "QUEUED" && job\.mode === "PRICE"/);
  assert.match(backgroundV039, /job\.status === "QUEUED" && job\.mode === "OPTION"/);
  assert.match(backgroundV039, /sortJobsPricesFirstV039/);
  assert.match(backgroundV039, /state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)/);
});

test("A21 v0.3.9 preserves delivery and form safety before submit", () => {
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

test("A21 v0.3.9 does not gate progress on per-market success results", () => {
  assert.match(backgroundV039, /마켓별 결과 검증 없음/);
  assert.doesNotMatch(backgroundV039, /failure > 0|성공여부.*FAILED/);
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
  assert.match(downloadRoute, /const VERSION = "0\.3\.9"/);
  assert.match(downloadRoute, /background-v039\.js/);
  assert.doesNotMatch(downloadRoute, /webRequest/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

test("A21 v0.3.9 keeps base worker serial safety", () => {
  assert.match(backgroundBase, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
});

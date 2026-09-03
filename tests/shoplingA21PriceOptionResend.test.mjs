import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainBridge, backgroundBase, backgroundTrackerV024, backgroundTrackerV025, backgroundSubmitAckV026, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v024.js", root), "utf8"),
  readFile(new URL("background-v025.js", root), "utf8"),
  readFile(new URL("background-v026.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.2.6 uses Shopling submit ACK as completion policy", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.2.6");
  assert.equal(manifest.background.service_worker, "background-v026.js");
  assert.match(backgroundSubmitAckV026, /importScripts\("background-v025\.js"\)/);
  assert.match(backgroundSubmitAckV026, /RESULT_WAIT/);
  assert.match(backgroundSubmitAckV026, /completeJob/);
  assert.match(backgroundSubmitAckV026, /마켓별 결과 검증 생략/);
  assert.match(popupRunHtml, /송신 ACK 기준/);
  assert.match(popupRun, /v0\.2\.6/);
});

test("A21 v0.2.6 preserves pre-submit delivery and field safety guards", () => {
  for (const source of [exactPopup, mainBridge]) {
    assert.match(source, /trsmt_env_mody_dlvyinfo/);
    assert.match(source, /수정\\s\*안함|수정안함/);
    assert.match(source, /forceDeliveryUnchanged/);
  }
  assert.match(exactPopup, /tsmt_sale_price_tp/);
  assert.match(exactPopup, /trsmt_env_mody_price/);
  assert.match(exactPopup, /goods_stock/);
  assert.match(exactPopup, /trsmt_env_mody_opt/);
  assert.match(mainBridge, /window\.goods_mallMdfy_submit_sp\(\)/);
});

test("A21 v0.2.6 remains serial while legacy result trackers become non-blocking", () => {
  assert.match(backgroundBase, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
  assert.match(backgroundTrackerV024, /monitorResult = monitorResultV024/);
  assert.match(backgroundTrackerV025, /monitorResult = monitorResultV025/);
  assert.match(backgroundSubmitAckV026, /setTimeout\(\(\) => void completeOnSubmitAck/);
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
  assert.match(downloadRoute, /const VERSION = "0\.2\.6"/);
  assert.match(downloadRoute, /background-v026\.js/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

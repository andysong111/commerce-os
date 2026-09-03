import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainBridge, backgroundBase, backgroundV027, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v027.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.2.7 skips all result tracking and completes on submit ACK", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.2.7");
  assert.equal(manifest.background.service_worker, "background-v027.js");
  assert.match(backgroundV027, /importScripts\("background-v020\.js"\)/);
  assert.doesNotMatch(backgroundV027, /background-v024|background-v025|monitorResultV02/);
  assert.match(backgroundV027, /RESULT_WAIT/);
  assert.match(backgroundV027, /completeJob/);
  assert.match(backgroundV027, /결과 검증 없음/);
  assert.match(popupRunHtml, /결과 추적 완전 제거/);
  assert.match(popupRun, /v0\.2\.7/);
});

test("A21 v0.2.7 preserves delivery and field safety before submit", () => {
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

test("A21 v0.2.7 remains serial and avoids the v0.2.5 baseline state race", () => {
  assert.match(backgroundBase, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
  assert.doesNotMatch(backgroundV027, /runBaselineShoplingTabIds|enrichRunBaseline|expectedResultSectionCount/);
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
  assert.match(downloadRoute, /const VERSION = "0\.2\.7"/);
  assert.match(downloadRoute, /background-v027\.js/);
  assert.doesNotMatch(downloadRoute, /background-v024\.js|background-v025\.js|background-v026\.js/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

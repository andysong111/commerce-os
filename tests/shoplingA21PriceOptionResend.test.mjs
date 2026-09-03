import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainSubmitBridge, backgroundBase, backgroundV038, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v038.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.3.8 identifies the exact result tab from Shopling webRequest events", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.3.8");
  assert.equal(manifest.background.service_worker, "background-v038.js");
  assert.ok(manifest.permissions.includes("webRequest"));
  assert.match(backgroundV038, /chrome\.webRequest\.onBeforeRequest/);
  assert.match(backgroundV038, /candidateResultTabIds/);
  assert.match(backgroundV038, /main_frame/);
  assert.ok(!manifest.content_scripts.some((row) => row.js?.some((name) => /result-(loading|bridge|relay|complete|wait)/.test(name))));
});

test("A21 v0.3.8 never advances on network-idle alone", () => {
  assert.doesNotMatch(backgroundV038, /networkQuietMs >=|QUIET_MS|activeCount > 0/);
  assert.match(backgroundV038, /probeResultTab/);
  assert.match(backgroundV038, /chrome\.scripting\.executeScript/);
  assert.match(backgroundV038, /처리중입니다/);
  assert.match(backgroundV038, /잠시만\\s\*기다려주시기\\s\*바랍니다/);
  assert.match(backgroundV038, /sawProcessing = true/);
  assert.match(backgroundV038, /if \(!sawProcessing\)/);
  assert.match(backgroundV038, /STABLE_MS = 1_800/);
  assert.match(backgroundV038, /실제 로딩 종료 감지/);
  assert.match(backgroundV038, /completeJob/);
  assert.match(popupRunHtml, /v0\.3\.8/);
  assert.match(popupRun, /처리중입니다\/잠시만 기다려주시기 바랍니다/);
});

test("A21 v0.3.8 preserves price-first serial queue", () => {
  assert.match(backgroundV038, /job\.status === "QUEUED" && job\.mode === "PRICE"/);
  assert.match(backgroundV038, /job\.status === "QUEUED" && job\.mode === "OPTION"/);
  assert.match(backgroundV038, /sortJobsPricesFirstV038/);
  assert.match(backgroundV038, /state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)/);
});

test("A21 v0.3.8 preserves delivery and form safety before submit", () => {
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

test("A21 v0.3.8 does not gate progress on per-market success results", () => {
  assert.match(backgroundV038, /결과 내용 검증 없음/);
  assert.doesNotMatch(backgroundV038, /failure > 0|성공여부.*FAILED/);
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
  assert.match(downloadRoute, /const VERSION = "0\.3\.8"/);
  assert.match(downloadRoute, /background-v038\.js/);
  assert.match(downloadRoute, /webRequest/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

test("A21 v0.3.8 keeps base worker serial safety", () => {
  assert.match(backgroundBase, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
});

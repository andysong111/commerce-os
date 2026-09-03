import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainBridge, backgroundBase, backgroundV030, backgroundV032, resultReporterV032, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v030.js", root), "utf8"),
  readFile(new URL("background-v032.js", root), "utf8"),
  readFile(new URL("result-complete-v032.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.3.2 lets the Shopling result document report completion directly", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.3.2");
  assert.equal(manifest.background.service_worker, "background-v032.js");
  const reporter = manifest.content_scripts.find((row) => row.js?.includes("result-complete-v032.js"));
  assert.ok(reporter);
  assert.equal(reporter.match_about_blank, true);
  assert.equal(reporter.match_origin_as_fallback, true);
  assert.match(backgroundV032, /importScripts\("background-v030\.js"\)/);
  assert.match(backgroundV032, /A21_RESULT_COMPLETE_V032/);
  assert.match(resultReporterV032, /상품\\s\*수정\\s\*전송이\\s\*완료되었습니다/);
  assert.match(resultReporterV032, /MutationObserver/);
  assert.match(resultReporterV032, /setInterval\(\(\) => void reportIfComplete\(\), 500\)/);
  assert.doesNotMatch(popupRun, /A21_RECONCILE_V031/);
  assert.match(popupRunHtml, /v0\.3\.2/);
});

test("A21 v0.3.2 keeps stale-result cleanup and price-first ordering", () => {
  assert.match(backgroundV030, /closeStaleResultTabs/);
  assert.match(backgroundV030, /job\.status === "QUEUED" && job\.mode === "PRICE"/);
  assert.match(backgroundV030, /job\.status === "QUEUED" && job\.mode === "OPTION"/);
  assert.match(backgroundV030, /sortJobsPricesFirstV030/);
  assert.match(popupRunHtml, /판매가 전체 우선/);
});

test("A21 v0.3.2 ignores per-market success or failure", () => {
  assert.match(backgroundV030, /monitorResult = async \(\) => \{\}/);
  assert.match(backgroundV032, /마켓 성공\/실패 검증 없음/);
  assert.doesNotMatch(backgroundV032, /failure > 0|성공여부/);
});

test("A21 v0.3.2 preserves delivery and field safety before submit", () => {
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

test("A21 v0.3.2 remains single-worker serial", () => {
  assert.match(backgroundBase, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
  assert.match(backgroundV030, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
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
  assert.match(downloadRoute, /const VERSION = "0\.3\.2"/);
  assert.match(downloadRoute, /background-v032\.js/);
  assert.match(downloadRoute, /result-complete-v032\.js/);
  assert.doesNotMatch(downloadRoute, /background-v031\.js|background-v028\.js|background-v029\.js|result-wait-v028\.js/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

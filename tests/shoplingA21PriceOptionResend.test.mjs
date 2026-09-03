import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainBridge, backgroundBase, backgroundV028, resultObserverV028, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v028.js", root), "utf8"),
  readFile(new URL("result-wait-v028.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.2.8 waits for Shopling processing overlay to finish without validating market success", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.2.8");
  assert.equal(manifest.background.service_worker, "background-v028.js");
  assert.ok(manifest.content_scripts.some((row) => row.js?.includes("result-wait-v028.js")));
  assert.match(backgroundV028, /monitorResult = async \(\) => \{\}/);
  assert.match(backgroundV028, /A21_RESULT_LOADING_V028/);
  assert.match(backgroundV028, /sawShoplingProcessing/);
  assert.match(backgroundV028, /로딩 종료/);
  assert.match(resultObserverV028, /처리중입니다/);
  assert.match(resultObserverV028, /잠시만\\s\*기다려주시기/);
  assert.match(resultObserverV028, /clearForMs/);
  assert.match(popupRunHtml, /Shopling 로딩 종료 후 다음 단계/);
  assert.match(popupRun, /v0\.2\.8/);
});

test("A21 v0.2.8 runs every PRICE batch before OPTION batches", () => {
  assert.match(backgroundV028, /job\.mode === "QUEUED" && job\.mode === "PRICE"/);
  assert.match(backgroundV028, /job\.status === "QUEUED" && job\.mode === "PRICE"/);
  assert.match(backgroundV028, /job\.status === "QUEUED" && job\.mode === "OPTION"/);
  assert.match(backgroundV028, /sortJobsPricesFirst/);
  assert.match(popupRunHtml, /판매가 전체 우선/);
  assert.match(popupRun, /모든 판매가 배치를 먼저 끝낸 뒤 옵션 배치/);
});

test("A21 v0.2.8 preserves delivery and field safety before submit", () => {
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

test("A21 v0.2.8 remains single-worker serial while using loading completion as the gate", () => {
  assert.match(backgroundBase, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
  assert.match(backgroundV028, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
  assert.doesNotMatch(backgroundV028, /background-v024|background-v025|background-v026|background-v027/);
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
  assert.match(downloadRoute, /const VERSION = "0\.2\.8"/);
  assert.match(downloadRoute, /background-v028\.js/);
  assert.match(downloadRoute, /result-wait-v028\.js/);
  assert.doesNotMatch(downloadRoute, /background-v024\.js|background-v025\.js|background-v026\.js|background-v027\.js/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

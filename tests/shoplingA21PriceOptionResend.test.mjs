import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainBridge, backgroundBase, backgroundV028, backgroundV029, resultObserverV028, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v028.js", root), "utf8"),
  readFile(new URL("background-v029.js", root), "utf8"),
  readFile(new URL("result-wait-v028.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.2.9 directly polls Shopling result pages so loading completion cannot be missed", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.2.9");
  assert.equal(manifest.background.service_worker, "background-v029.js");
  assert.ok(manifest.content_scripts.some((row) => row.js?.includes("result-wait-v028.js")));
  assert.match(backgroundV029, /importScripts\("background-v028\.js"\)/);
  assert.match(backgroundV029, /chrome\.scripting\.executeScript/);
  assert.match(backgroundV029, /처리중입니다/);
  assert.match(backgroundV029, /resultEvidence/);
  assert.match(backgroundV029, /CLEAR_GRACE_MS = 2_000/);
  assert.match(backgroundV029, /WAIT_LIMIT_MS = 20 \* 60 \* 1000/);
  assert.match(backgroundV029, /직접 확인/);
  assert.match(resultObserverV028, /처리중입니다/);
  assert.match(popupRunHtml, /로딩 종료 직접 확인/);
  assert.match(popupRun, /v0\.2\.9/);
});

test("A21 v0.2.9 still waits for loading only, not market success or failure", () => {
  assert.match(backgroundV028, /monitorResult = async \(\) => \{\}/);
  assert.match(backgroundV029, /마켓 성공\/실패 검증 없음/);
  assert.doesNotMatch(backgroundV029, /성공건수\s*\[:/);
  assert.doesNotMatch(backgroundV029, /실패건수\s*\[:/);
});

test("A21 v0.2.9 runs every PRICE batch before OPTION batches", () => {
  assert.match(backgroundV028, /job\.status === "QUEUED" && job\.mode === "PRICE"/);
  assert.match(backgroundV028, /job\.status === "QUEUED" && job\.mode === "OPTION"/);
  assert.match(backgroundV028, /sortJobsPricesFirst/);
  assert.match(popupRunHtml, /판매가 전체 우선/);
  assert.match(popupRun, /모든 판매가 배치를 먼저 끝낸 뒤 옵션 배치/);
});

test("A21 v0.2.9 preserves delivery and field safety before submit", () => {
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

test("A21 v0.2.9 remains single-worker serial while loading completion is the gate", () => {
  assert.match(backgroundBase, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
  assert.match(backgroundV028, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
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
  assert.match(downloadRoute, /const VERSION = "0\.2\.9"/);
  assert.match(downloadRoute, /background-v029\.js/);
  assert.match(downloadRoute, /background-v028\.js/);
  assert.match(downloadRoute, /result-wait-v028\.js/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

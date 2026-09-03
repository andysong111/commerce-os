import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainSubmitBridge, backgroundBase, backgroundV037, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v037.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.3.7 uses Chrome webRequest instead of result DOM observation", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.3.7");
  assert.equal(manifest.background.service_worker, "background-v037.js");
  assert.ok(manifest.permissions.includes("webRequest"));
  assert.ok(!manifest.content_scripts.some((row) => row.js?.some((name) => /result-(loading|bridge|relay|complete|wait)/.test(name))));
  assert.match(backgroundV037, /chrome\.webRequest\.onBeforeRequest/);
  assert.match(backgroundV037, /chrome\.webRequest\.onCompleted/);
  assert.match(backgroundV037, /chrome\.webRequest\.onErrorOccurred/);
  assert.match(backgroundV037, /main_frame/);
  assert.match(backgroundV037, /sub_frame/);
  assert.match(backgroundV037, /xmlhttprequest/);
});

test("A21 v0.3.7 advances only after Shopling network becomes quiet", () => {
  assert.match(backgroundV037, /QUIET_MS = 2_500/);
  assert.match(backgroundV037, /MIN_WAIT_MS = 3_000/);
  assert.match(backgroundV037, /activeRequests/);
  assert.match(backgroundV037, /snap\.activeCount > 0/);
  assert.match(backgroundV037, /networkQuietMs >= QUIET_MS/);
  assert.match(backgroundV037, /stableQuietMs >= QUIET_MS/);
  assert.match(backgroundV037, /Shopling 네트워크 종료 감지/);
  assert.match(backgroundV037, /completeJob/);
  assert.match(popupRunHtml, /v0\.3\.7/);
  assert.match(popupRun, /Chrome webRequest/);
});

test("A21 v0.3.7 preserves price-first serial queue", () => {
  assert.match(backgroundV037, /job\.status === "QUEUED" && job\.mode === "PRICE"/);
  assert.match(backgroundV037, /job\.status === "QUEUED" && job\.mode === "OPTION"/);
  assert.match(backgroundV037, /sortJobsPricesFirstV037/);
  assert.match(backgroundV037, /state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)/);
});

test("A21 v0.3.7 preserves delivery and form safety before submit", () => {
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

test("A21 v0.3.7 does not gate progress on per-market success or footer text", () => {
  assert.doesNotMatch(backgroundV037, /상품\\s\*수정\\s\*전송이\\s\*완료되었습니다/);
  assert.doesNotMatch(backgroundV037, /성공건수|실패건수|성공여부/);
  assert.match(backgroundV037, /결과 내용 검증 없음/);
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
  assert.match(downloadRoute, /const VERSION = "0\.3\.7"/);
  assert.match(downloadRoute, /background-v037\.js/);
  assert.match(downloadRoute, /webRequest/);
  assert.doesNotMatch(downloadRoute, /background-v036\.js|result-loading-v036\.js/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

test("A21 v0.3.7 keeps base worker serial safety", () => {
  assert.match(backgroundBase, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
});

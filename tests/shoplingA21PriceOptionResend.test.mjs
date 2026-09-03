import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainSubmitBridge, mainResultBridge, resultRelay, backgroundBase, backgroundV030, backgroundV033, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("main-result-bridge-v033.js", root), "utf8"),
  readFile(new URL("result-relay-v033.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v030.js", root), "utf8"),
  readFile(new URL("background-v033.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.3.3 tracks the exact Shopling result window opened by the transmit page", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.3.3");
  assert.equal(manifest.background.service_worker, "background-v033.js");
  const mainRuntime = manifest.content_scripts.find((row) => row.world === "MAIN" && row.js?.includes("main-a21-v024.js"));
  assert.ok(mainRuntime?.js?.includes("main-result-bridge-v033.js"));
  const isolatedRuntime = manifest.content_scripts.find((row) => row.js?.includes("content-a21-v024.js"));
  assert.ok(isolatedRuntime?.js?.includes("result-relay-v033.js"));
  assert.ok(!manifest.content_scripts.some((row) => row.js?.includes("result-complete-v032.js")));
});

test("A21 v0.3.3 auto-scrolls the result window until the delayed footer is rendered", () => {
  assert.match(mainResultBridge, /window\.open = function commerceOsA21WindowOpen/);
  assert.match(mainResultBridge, /autoScrollDocument/);
  assert.match(mainResultBridge, /child\.scrollTo\(0, height\)/);
  assert.match(mainResultBridge, /node\.scrollTop = node\.scrollHeight/);
  assert.match(mainResultBridge, /상품\\s\*수정\\s\*전송이\\s\*완료되었습니다/);
  assert.match(mainResultBridge, /commerce-os-a21-v033-result-complete/);
  assert.match(resultRelay, /A21_RESULT_COMPLETE_V033/);
  assert.match(backgroundV033, /A21_RESULT_COMPLETE_V033/);
  assert.match(backgroundV033, /SUBMIT_CLICKED.*RESULT_WAIT|RESULT_WAIT.*SUBMIT_CLICKED/s);
  assert.match(popupRunHtml, /v0\.3\.3/);
  assert.match(popupRun, /자동으로 끝까지 스크롤/);
});

test("A21 v0.3.3 keeps price-first ordering and ignores per-market result failures", () => {
  assert.match(backgroundV030, /job\.status === "QUEUED" && job\.mode === "PRICE"/);
  assert.match(backgroundV030, /job\.status === "QUEUED" && job\.mode === "OPTION"/);
  assert.match(backgroundV030, /sortJobsPricesFirstV030/);
  assert.match(backgroundV033, /마켓 성공\/실패 검증 없음/);
  assert.doesNotMatch(backgroundV033, /failure > 0|성공여부/);
});

test("A21 v0.3.3 preserves delivery and form safety before submit", () => {
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

test("A21 v0.3.3 remains single-worker serial", () => {
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
  assert.match(downloadRoute, /const VERSION = "0\.3\.3"/);
  assert.match(downloadRoute, /background-v033\.js/);
  assert.match(downloadRoute, /main-result-bridge-v033\.js/);
  assert.match(downloadRoute, /result-relay-v033\.js/);
  assert.doesNotMatch(downloadRoute, /result-complete-v032\.js/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

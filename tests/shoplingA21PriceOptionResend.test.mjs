import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainSubmitBridge, backgroundBase, backgroundV030, backgroundV035, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v030.js", root), "utf8"),
  readFile(new URL("background-v035.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.3.5 leaves Shopling result window creation native", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.3.5");
  assert.equal(manifest.background.service_worker, "background-v035.js");
  const mainRuntime = manifest.content_scripts.find((row) => row.world === "MAIN" && row.js?.includes("main-a21-v024.js"));
  assert.ok(mainRuntime);
  assert.equal(mainRuntime.js.length, 1);
  const isolatedRuntime = manifest.content_scripts.find((row) => row.js?.includes("content-a21-v024.js"));
  assert.ok(isolatedRuntime);
  assert.equal(isolatedRuntime.js.length, 1);
  assert.ok(!manifest.content_scripts.some((row) => row.js?.some((name) => /result-(bridge|relay|complete|wait)/.test(name))));
});

test("A21 v0.3.5 detects actual Shopling loading end instead of completion footer", () => {
  assert.match(backgroundV035, /chrome\.windows\.getAll\(\{ populate: true \}\)/);
  assert.match(backgroundV035, /chrome\.scripting\.executeScript/);
  assert.match(backgroundV035, /처리중입니다/);
  assert.match(backgroundV035, /잠시만\\s\*기다려주시기\\s\*바랍니다/);
  assert.match(backgroundV035, /쇼핑몰\\s\*상품\\s\*수정\\s\*전송\\s\*결과/);
  assert.match(backgroundV035, /STABLE_MS = 1_800/);
  assert.match(backgroundV035, /document\.readyState/);
  assert.match(backgroundV035, /Shopling 로딩 종료 감지/);
  assert.match(backgroundV035, /footer 검증 불필요/);
  assert.match(popupRunHtml, /v0\.3\.5/);
  assert.match(popupRun, /처리중입니다\/잠시만 기다려주시기 바랍니다/);
});

test("A21 v0.3.5 keeps price-first ordering and ignores per-market result failures", () => {
  assert.match(backgroundV030, /job\.status === "QUEUED" && job\.mode === "PRICE"/);
  assert.match(backgroundV030, /job\.status === "QUEUED" && job\.mode === "OPTION"/);
  assert.match(backgroundV030, /sortJobsPricesFirstV030/);
  assert.match(backgroundV035, /마켓 성공\/실패\/완료 footer 검증 없음/);
  assert.doesNotMatch(backgroundV035, /failure > 0|성공여부.*FAILED/);
});

test("A21 v0.3.5 preserves delivery and form safety before submit", () => {
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

test("A21 v0.3.5 remains single-worker serial", () => {
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
  assert.match(downloadRoute, /const VERSION = "0\.3\.5"/);
  assert.match(downloadRoute, /background-v035\.js/);
  assert.doesNotMatch(downloadRoute, /background-v034\.js|main-result-bridge-v034\.js|result-relay-v034\.js/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

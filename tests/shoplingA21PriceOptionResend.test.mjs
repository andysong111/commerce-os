import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainBridge, backgroundBase, backgroundV030, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v030.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.3.0 uses the explicit Shopling completion footer as the next-step gate", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.3.0");
  assert.equal(manifest.background.service_worker, "background-v030.js");
  assert.ok(!manifest.content_scripts.some((row) => row.js?.includes("result-wait-v028.js")));
  assert.match(backgroundV030, /importScripts\("background-v020\.js"\)/);
  assert.match(backgroundV030, /상품\\s\*수정\\s\*전송이\\s\*완료되었습니다/);
  assert.match(backgroundV030, /COMPLETE_GRACE_MS = 1_500/);
  assert.match(backgroundV030, /WAIT_LIMIT_MS = 20 \* 60 \* 1000/);
  assert.match(backgroundV030, /watchCompletionFooter/);
  assert.match(popupRunHtml, /상품 수정 전송이 완료되었습니다/);
  assert.match(popupRun, /v0\.3\.0/);
});

test("A21 v0.3.0 cleans stale result pages and scans all Shopling tabs directly", () => {
  assert.match(backgroundV030, /closeStaleResultTabs/);
  assert.match(backgroundV030, /staleResultTabIds/);
  assert.match(backgroundV030, /chrome\.tabs\.query/);
  assert.match(backgroundV030, /chrome\.scripting\.executeScript/);
  assert.doesNotMatch(backgroundV030, /runBaselineShoplingTabIds|senderBelongsToJob/);
});

test("A21 v0.3.0 ignores per-market success or failure while still blocking during processing", () => {
  assert.match(backgroundV030, /monitorResult = async \(\) => \{\}/);
  assert.match(backgroundV030, /processing/);
  assert.match(backgroundV030, /마켓 성공\/실패 검증 없음/);
  assert.doesNotMatch(backgroundV030, /failure > 0|성공여부/);
});

test("A21 v0.3.0 runs every PRICE batch before OPTION batches", () => {
  assert.match(backgroundV030, /job\.status === "QUEUED" && job\.mode === "PRICE"/);
  assert.match(backgroundV030, /job\.status === "QUEUED" && job\.mode === "OPTION"/);
  assert.match(backgroundV030, /sortJobsPricesFirstV030/);
  assert.match(popupRunHtml, /판매가 전체 우선/);
  assert.match(popupRun, /모든 판매가 배치를 먼저 끝낸 뒤 옵션 배치/);
});

test("A21 v0.3.0 preserves delivery and field safety before submit", () => {
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

test("A21 v0.3.0 remains single-worker serial", () => {
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
  assert.match(downloadRoute, /const VERSION = "0\.3\.0"/);
  assert.match(downloadRoute, /background-v030\.js/);
  assert.doesNotMatch(downloadRoute, /background-v028\.js|background-v029\.js|result-wait-v028\.js/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

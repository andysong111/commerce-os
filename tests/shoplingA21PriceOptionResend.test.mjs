import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainSubmitBridge, mainResultBridge, resultRelay, backgroundBase, backgroundV030, backgroundV034, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("main-result-bridge-v034.js", root), "utf8"),
  readFile(new URL("result-relay-v034.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v030.js", root), "utf8"),
  readFile(new URL("background-v034.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.3.4 captures the Shopling form target result window", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.3.4");
  assert.equal(manifest.background.service_worker, "background-v034.js");
  const mainRuntime = manifest.content_scripts.find((row) => row.world === "MAIN" && row.js?.includes("main-a21-v024.js"));
  assert.ok(mainRuntime?.js?.includes("main-result-bridge-v034.js"));
  const isolatedRuntime = manifest.content_scripts.find((row) => row.js?.includes("content-a21-v024.js"));
  assert.ok(isolatedRuntime?.js?.includes("result-relay-v034.js"));
  assert.match(mainResultBridge, /HTMLFormElement\.prototype\.submit/);
  assert.match(mainResultBridge, /HTMLFormElement\.prototype\.requestSubmit/);
  assert.match(mainResultBridge, /commerce_os_a21_result_/);
});

test("A21 v0.3.4 blocks duplicate Shopling submit and auto-scrolls one result window", () => {
  assert.match(mainResultBridge, /goods_mallMdfy_submit_sp/);
  assert.match(mainResultBridge, /now - lastSubmitAt < 5000/);
  assert.match(mainResultBridge, /window\.open = function commerceOsA21WindowOpen/);
  assert.match(mainResultBridge, /autoScrollDocument/);
  assert.match(mainResultBridge, /root\.scrollTop = height/);
  assert.match(mainResultBridge, /node\.scrollTop = scrollHeight/);
  assert.match(mainResultBridge, /상품\\s\*수정\\s\*전송이\\s\*완료되었습니다/);
  assert.match(mainResultBridge, /commerce-os-a21-v034-result-complete/);
  assert.match(resultRelay, /A21_RESULT_COMPLETE_V034/);
  assert.match(backgroundV034, /A21_RESULT_COMPLETE_V034/);
  assert.match(backgroundV034, /closeStaleShoplingPopupWindows/);
  assert.match(popupRunHtml, /v0\.3\.4/);
  assert.match(popupRun, /두 번째 송신을 차단/);
});

test("A21 v0.3.4 keeps price-first ordering and ignores per-market result failures", () => {
  assert.match(backgroundV030, /job\.status === "QUEUED" && job\.mode === "PRICE"/);
  assert.match(backgroundV030, /job\.status === "QUEUED" && job\.mode === "OPTION"/);
  assert.match(backgroundV030, /sortJobsPricesFirstV030/);
  assert.match(backgroundV034, /마켓 성공\/실패 검증 없음/);
  assert.doesNotMatch(backgroundV034, /failure > 0|성공여부/);
});

test("A21 v0.3.4 preserves delivery and form safety before submit", () => {
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

test("A21 v0.3.4 remains single-worker serial", () => {
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
  assert.match(downloadRoute, /const VERSION = "0\.3\.4"/);
  assert.match(downloadRoute, /background-v034\.js/);
  assert.match(downloadRoute, /main-result-bridge-v034\.js/);
  assert.match(downloadRoute, /result-relay-v034\.js/);
  assert.doesNotMatch(downloadRoute, /main-result-bridge-v033\.js|result-relay-v033\.js|result-complete-v032\.js/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

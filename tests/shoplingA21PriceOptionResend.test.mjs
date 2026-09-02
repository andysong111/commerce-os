import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, backgroundBase, backgroundWrapper, backgroundOverlay, content, contentOverlay, popup, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("background-v012.js", root), "utf8"),
  readFile(new URL("background-v013.js", root), "utf8"),
  readFile(new URL("background-v013-overlay.js", root), "utf8"),
  readFile(new URL("content-a21.js", root), "utf8"),
  readFile(new URL("content-a21-v014.js", root), "utf8"),
  readFile(new URL("popup.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 resend extension is fail-closed and keeps price/option separate", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.1.4");
  assert.equal(manifest.background.service_worker, "background-v013.js");
  assert.ok(manifest.permissions.includes("windows"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.permissions.includes("scripting"));
  assert.match(backgroundBase, /MAX_CONCURRENT = 4/);
  assert.match(backgroundBase, /MAX_SEARCH_CODES = 200/);
  assert.match(backgroundBase, /A21_SPLIT_REQUIRED/);
  assert.match(backgroundBase, /A21_POPUP_RESULT_ASSIGNMENT/);
  assert.match(backgroundWrapper, /background-v012\.js/);
  assert.match(backgroundWrapper, /background-v013-overlay\.js/);
  assert.match(content, /MAX_VISIBLE_RESULTS = 500/);
  assert.match(content, /쇼핑몰별판매가/);
  assert.match(content, /A21_VISIBLE_ROW_COUNT_MISMATCH/);
  assert.match(content, /A21_ROW_SELECTION_MISMATCH/);
  assert.match(popup, /Shopling 가격 재조회 VERIFIED/);
});

test("A21 v0.1.4 selects only 판매가 for general modification before submit", () => {
  assert.match(contentOverlay, /GENERAL_ROWS/);
  assert.match(contentOverlay, /"상품명", "판매가", "카테고리"/);
  assert.match(contentOverlay, /label === "판매가"/);
  assert.match(contentOverlay, /verifyPriceConfiguration/);
  assert.match(contentOverlay, /A21_PRICE_CONFIGURATION_VERIFY_FAILED/);
  assert.match(contentOverlay, /A21_PRICE_CONFIGURATION_CHANGED/);
  assert.match(contentOverlay, /쇼핑몰배송정보/);
});

test("A21 v0.1.4 keeps option transmission separate and supports legacy submit controls", () => {
  assert.match(contentOverlay, /modeRadio\("옵션송신"\)/);
  assert.match(contentOverlay, /optionSelectionControl/);
  assert.match(contentOverlay, /추가상품송신/);
  assert.match(contentOverlay, /input\[type=\\"image\\"\]/);
  assert.match(contentOverlay, /\[onclick\]/);
  assert.match(contentOverlay, /A21_SUBMIT_BUTTON_NOT_FOUND_V014/);
  assert.match(contentOverlay, /clickSubmitButton/);
});

test("A21 v0.1.4 binds only the popup opened by the exact worker", () => {
  assert.match(contentOverlay, /commerce-os-a21-v014:/);
  assert.match(contentOverlay, /window\.opener\?\.name/);
  assert.match(contentOverlay, /A21_POPUP_READY_V013/);
  assert.match(backgroundOverlay, /popupAutoV013/);
  assert.match(backgroundOverlay, /popupAssignmentBusy = true/);
});

test("A21 resend can start from A18 and does not fail while a Shopling popup is still about:blank", () => {
  assert.match(popup, /A18 빈 화면에서도 실행할 수 있습니다/);
  assert.doesNotMatch(popup, /A21_IDENTIFY/);
  assert.match(backgroundBase, /Shopling 로그인 탭\(A18 빈 화면 포함\)/);
  assert.match(backgroundBase, /clickA21Menu/);
  assert.match(backgroundBase, /waitForA21ListFrame/);
  assert.match(backgroundBase, /chrome\.scripting\.executeScript/);
  assert.match(backgroundBase, /injectContentIfMissing/);
  assert.match(backgroundBase, /frameIds: \[frameId\]/);
  assert.match(backgroundBase, /about:blank/);
  assert.match(backgroundBase, /transientFrameError/);
  assert.match(backgroundBase, /waitForPopupFrame/);
  assert.match(backgroundBase, /discoverPopupForJob/);
});

test("A21 resend plan is only released after full Shopling readback verification", () => {
  for (const needle of [
    'readback.state === "VERIFIED"',
    "readback.verifiedGoodsKeyCount === plan.goodsKeyCount",
    "readback.failedGoodsKeyCount === 0",
    "readback.mallMismatchCount === 0",
    "readback.mallMissingCount === 0",
    "readback.mallMatchCount === readback.mallCheckCount",
  ]) {
    assert.ok(planRoute.includes(needle), `missing ${needle}`);
  }
  assert.match(planRoute, /sourcePrice: "SHOPPING_MALL_SPECIFIC_SELL_PRICE"/);
  assert.match(planRoute, /priceMode: "PRICE_ONLY"/);
  assert.match(planRoute, /optionMode: "OPTION_ONLY"/);
  assert.match(downloadRoute, /const VERSION = "0\.1\.4"/);
  assert.match(downloadRoute, /background-v013\.js/);
  assert.match(downloadRoute, /content-a21-v014\.js/);
  assert.match(downloadRoute, /entries\[fileName\]/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

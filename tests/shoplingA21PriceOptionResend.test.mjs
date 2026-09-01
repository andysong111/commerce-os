import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, background, content, popup, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("background.js", root), "utf8"),
  readFile(new URL("content-a21.js", root), "utf8"),
  readFile(new URL("popup.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 resend extension is fail-closed and keeps price/option separate", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.1.0");
  assert.ok(manifest.permissions.includes("windows"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.match(background, /MAX_CONCURRENT = 4/);
  assert.match(background, /MAX_SEARCH_CODES = 200/);
  assert.match(background, /A21_SPLIT_REQUIRED/);
  assert.match(background, /A21_POPUP_RESULT_ASSIGNMENT/);
  assert.match(content, /MAX_VISIBLE_RESULTS = 500/);
  assert.match(content, /쇼핑몰별판매가/);
  assert.match(content, /configurePricePopup/);
  assert.match(content, /configureOptionPopup/);
  assert.match(content, /A21_VISIBLE_ROW_COUNT_MISMATCH/);
  assert.match(content, /A21_ROW_SELECTION_MISMATCH/);
  assert.match(popup, /Shopling 가격 재조회 VERIFIED/);
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
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

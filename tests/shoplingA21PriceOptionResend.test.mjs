import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v019.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.1.9 uses the exact Shopling popup runtime", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.1.9");
  assert.equal(manifest.action.default_popup, "popup-run.html");
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("windows"));
  assert.ok(manifest.permissions.includes("webNavigation"));
  assert.ok(manifest.content_scripts.some((row) => row.js?.includes("content-a21-v019.js")));
  assert.match(popupRunHtml, /실제 Shopling form name\/value 기준 전송/);
  assert.match(popupRun, /A21_START/);
});

test("A21 v0.1.9 selects only mall-specific price using exact field names", () => {
  assert.match(exactPopup, /tsmt_sale_price_tp/);
  assert.match(exactPopup, /value !== "J"/);
  assert.match(exactPopup, /trsmt_env_mody_price/);
  assert.match(exactPopup, /trsmt_env_mody_item_nm/);
  assert.match(exactPopup, /trsmt_env_mody_dlvyinfo/);
  assert.match(exactPopup, /modify_tp/);
  assert.match(exactPopup, /goods_normal/);
  assert.match(exactPopup, /name === "trsmt_env_mody_price" \? "Y" : ""/);
});

test("A21 v0.1.9 sends option-only using exact field names", () => {
  assert.match(exactPopup, /goods_stock/);
  assert.match(exactPopup, /trsmt_env_mody_opt/);
  assert.match(exactPopup, /selectRadio\("trsmt_env_mody_opt", "1"\)/);
  assert.match(exactPopup, /verifyRadio\("trsmt_env_mody_opt", "1"\)/);
});

test("A21 v0.1.9 prevents legacy popup injection and submits only through the verified Shopling button", () => {
  assert.match(exactPopup, /message\?\.type === "A21_IDENTIFY"/);
  assert.match(exactPopup, /goods_mallMdfy_submit_sp/);
  assert.match(exactPopup, /normalize\(item\.value\) === "상품수정 송신"/);
  assert.match(exactPopup, /V019_PRE_SUBMIT_RECHECK/);
  assert.match(exactPopup, /prod_join_chk\[\]/);
});

test("A21 resend plan remains gated by full Shopling readback verification", () => {
  for (const needle of [
    'readback.state === "VERIFIED"',
    "readback.verifiedGoodsKeyCount === plan.goodsKeyCount",
    "readback.failedGoodsKeyCount === 0",
    "readback.mallMismatchCount === 0",
    "readback.mallMissingCount === 0",
    "readback.mallMatchCount === readback.mallCheckCount",
  ]) assert.ok(planRoute.includes(needle), `missing ${needle}`);
  assert.match(downloadRoute, /const VERSION = "0\.1\.9"/);
  assert.match(downloadRoute, /content-a21-v019\.js/);
  assert.match(downloadRoute, /popup-run\.html/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, background, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v020.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.2.0 uses serial exact-form Shopling runtime", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.2.0");
  assert.equal(manifest.background.service_worker, "background-v020.js");
  assert.equal(manifest.action.default_popup, "popup-run.html");
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("windows"));
  assert.ok(manifest.permissions.includes("webNavigation"));
  assert.ok(manifest.content_scripts.some((row) => row.js?.includes("content-a21-v020.js")));
  assert.match(popupRunHtml, /동시 1개 직렬 안전전송/);
  assert.match(popupRunHtml, /1 GOODSKEY 안전 테스트/);
  assert.match(popupRun, /testMode/);
});

test("A21 v0.2.0 serializes jobs so popup claim is unique", () => {
  assert.match(background, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
  assert.match(background, /A21_POPUP_CLAIM_V020/);
  assert.match(background, /candidates\.length !== 1/);
  assert.match(background, /baselinePopupTabIds/);
  assert.match(background, /newPopupCandidates/);
});

test("A21 v0.2.0 selects only mall-specific price using exact field names", () => {
  assert.match(exactPopup, /tsmt_sale_price_tp/);
  assert.match(exactPopup, /value !== "J"/);
  assert.match(exactPopup, /trsmt_env_mody_price/);
  assert.match(exactPopup, /trsmt_env_mody_item_nm/);
  assert.match(exactPopup, /trsmt_env_mody_dlvyinfo/);
  assert.match(exactPopup, /modify_tp/);
  assert.match(exactPopup, /goods_normal/);
  assert.match(exactPopup, /name === "trsmt_env_mody_price" \? "Y" : ""/);
});

test("A21 v0.2.0 sends option-only and exact Shopling submit button", () => {
  assert.match(exactPopup, /goods_stock/);
  assert.match(exactPopup, /trsmt_env_mody_opt/);
  assert.match(exactPopup, /selectRadio\("trsmt_env_mody_opt", "1"\)/);
  assert.match(exactPopup, /verifyRadio\("trsmt_env_mody_opt", "1"\)/);
  assert.match(exactPopup, /goods_mallMdfy_submit_sp/);
  assert.match(exactPopup, /normalize\(item\.value\) === "상품수정 송신"/);
  assert.match(exactPopup, /prod_join_chk\[\]/);
  assert.match(exactPopup, /1200/);
});

test("A21 v0.2.0 background verifies Shopling result independently", () => {
  assert.match(background, /inspectResult/);
  assert.match(background, /성공건수/);
  assert.match(background, /실패건수/);
  assert.match(background, /monitorResult/);
  assert.match(background, /V020_RESULT_TIMEOUT/);
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
  assert.match(downloadRoute, /const VERSION = "0\.2\.0"/);
  assert.match(downloadRoute, /background-v020\.js/);
  assert.match(downloadRoute, /content-a21-v020\.js/);
  assert.match(downloadRoute, /popup-run\.html/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainBridge, background, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v022.js", root), "utf8"),
  readFile(new URL("main-a21-v022.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.2.2 uses serial isolated + MAIN-world Shopling runtime", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.2.2");
  assert.equal(manifest.background.service_worker, "background-v020.js");
  assert.equal(manifest.action.default_popup, "popup-run.html");
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("windows"));
  assert.ok(manifest.permissions.includes("webNavigation"));
  assert.ok(manifest.content_scripts.some((row) => row.js?.includes("content-a21-v022.js")));
  assert.ok(manifest.content_scripts.some((row) => row.js?.includes("main-a21-v022.js") && row.world === "MAIN"));
  assert.match(popupRunHtml, /배송정보 수정안함 고정/);
  assert.match(popupRunHtml, /1 GOODSKEY 안전 테스트/);
  assert.match(popupRun, /testMode/);
});

test("A21 v0.2.2 serializes jobs so popup claim is unique", () => {
  assert.match(background, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
  assert.match(background, /A21_POPUP_CLAIM_V020/);
  assert.match(background, /candidates\.length !== 1/);
  assert.match(background, /baselinePopupTabIds/);
  assert.match(background, /newPopupCandidates/);
});

test("A21 v0.2.2 selects only mall-specific price and keeps delivery info unchanged", () => {
  assert.match(exactPopup, /tsmt_sale_price_tp/);
  assert.match(exactPopup, /value !== "J"/);
  assert.match(exactPopup, /trsmt_env_mody_price/);
  assert.match(exactPopup, /trsmt_env_mody_dlvyinfo/);
  assert.match(exactPopup, /verifyRadio\("trsmt_env_mody_dlvyinfo", ""\)/);
  assert.match(exactPopup, /V022_DELIVERY_GUARD/);
  assert.match(mainBridge, /v022_delivery_must_remain_unchanged/);
  assert.match(mainBridge, /deliveryInfoUnchanged/);
});

test("A21 v0.2.2 sends option-only and invokes original Shopling function in MAIN world", () => {
  assert.match(exactPopup, /goods_stock/);
  assert.match(exactPopup, /trsmt_env_mody_opt/);
  assert.match(exactPopup, /selectRadio\("trsmt_env_mody_opt", "1"\)/);
  assert.match(exactPopup, /commerce-os-a21-v022-main-submit-request/);
  assert.match(mainBridge, /typeof window\.goods_mallMdfy_submit_sp !== "function"/);
  assert.match(mainBridge, /window\.goods_mallMdfy_submit_sp\(\)/);
  assert.match(mainBridge, /수정전송\\s\*할\\s\*상품을\\s\*선택하셨습니까/);
  assert.match(mainBridge, /배송정보.*수정되지/);
  assert.match(mainBridge, /unexpected_confirm/);
  assert.match(mainBridge, /unexpected_alert/);
});

test("A21 v0.2.2 background verifies Shopling result independently", () => {
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
  assert.match(downloadRoute, /const VERSION = "0\.2\.2"/);
  assert.match(downloadRoute, /background-v020\.js/);
  assert.match(downloadRoute, /main-a21-v022\.js/);
  assert.match(downloadRoute, /content-a21-v022\.js/);
  assert.match(downloadRoute, /popup-run\.html/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

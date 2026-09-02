import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popup, popupHtml, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup.js", root), "utf8"),
  readFile(new URL("popup.html", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.1.8 is diagnostic-only and keeps auto-send locked", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.1.8");
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("windows"));
  assert.ok(manifest.permissions.includes("webNavigation"));
  assert.match(popup, /DIAGNOSTIC_ONLY = true/);
  assert.match(popupHtml, /진단 완료 전 자동전송 잠금/);
  assert.match(popupHtml, /열린 상품수정 송신 팝업 DOM 진단/);
});

test("A21 v0.1.8 diagnoses exact Shopling popup URL across all Chrome windows", () => {
  assert.match(popup, /TARGET_POPUP_PATH = "\/prodlinkage\/goods_mallMdfy_trsmt\.phtml"/);
  assert.match(popup, /chrome\.windows\.getAll\(\{ populate: true \}\)/);
  assert.match(popup, /isTargetPopupUrl/);
  assert.match(popup, /chrome\.scripting\.executeScript/);
  assert.match(popup, /target: \{ tabId: tab\.id \}/);
  assert.match(popup, /allFrames: true/);
  assert.match(popup, /exactPopupTabCount/);
});

test("A21 diagnostic captures exact form controls without clicking submit", () => {
  assert.match(popup, /diagnosticProbe/);
  assert.match(popup, /document\.querySelectorAll\("input"\)/);
  assert.match(popup, /name: el\.name/);
  assert.match(popup, /value: el\.value/);
  assert.match(popup, /checked: Boolean\(el\.checked\)/);
  assert.match(popup, /onclick: el\.getAttribute\("onclick"\)/);
  assert.match(popup, /hiddenInputs/);
  assert.doesNotMatch(popup, /A21_START.*, sourceTabId/);
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
  assert.match(downloadRoute, /const VERSION = "0\.1\.8"/);
  assert.match(downloadRoute, /content-a21-v016\.js/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

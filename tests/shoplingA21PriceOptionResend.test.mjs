import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainBridge, backgroundBase, backgroundTracker, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v024.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.2.4 isolates list runtime and loads the v0.2.4 safety runtimes", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.2.4");
  assert.equal(manifest.background.service_worker, "background-v024.js");
  assert.equal(manifest.action.default_popup, "popup-run.html");
  assert.ok(manifest.permissions.includes("scripting"));
  assert.ok(manifest.permissions.includes("windows"));
  assert.ok(manifest.permissions.includes("webNavigation"));
  const listRuntime = manifest.content_scripts.find((row) => row.js?.includes("content-a21.js"));
  assert.ok(listRuntime);
  assert.ok(listRuntime.exclude_matches?.some((match) => match.includes("goods_mallMdfy_trsmt.phtml")));
  assert.notEqual(listRuntime.match_about_blank, true);
  assert.ok(manifest.content_scripts.some((row) => row.js?.includes("content-a21-v024.js")));
  assert.ok(manifest.content_scripts.some((row) => row.js?.includes("main-a21-v024.js") && row.world === "MAIN"));
  assert.match(popupRunHtml, /결과창 이동\/닫힘 추적/);
  assert.match(popupRunHtml, /배송정보 실화면 수정안함/);
  assert.match(popupRunHtml, /1 GOODSKEY 안전 테스트/);
  assert.match(popupRun, /v0\.2\.4/);
  assert.match(popupRun, /testMode/);
});

test("A21 v0.2.4 selects delivery unchanged by DOM evidence instead of value-only assumption", () => {
  for (const source of [exactPopup, mainBridge]) {
    assert.match(source, /trsmt_env_mody_dlvyinfo/);
    assert.match(source, /수정\\s\*안함|수정안함/);
    assert.match(source, /dlvy_notice/);
    assert.match(source, /commerceOsDeliveryUnchanged/);
    assert.match(source, /forceDeliveryUnchanged/);
    assert.match(source, /deliveryDiagnostics/);
  }
  assert.doesNotMatch(exactPopup, /verifyRadio\("trsmt_env_mody_dlvyinfo", ""\)/);
  assert.match(mainBridge, /v024_delivery_label_guard_invalid/);
  assert.match(mainBridge, /deliveryInfoUnchanged/);
});

test("A21 v0.2.4 keeps non-delivery price fields isolated and option send unchanged", () => {
  assert.match(exactPopup, /tsmt_sale_price_tp/);
  assert.match(exactPopup, /value !== "J"/);
  assert.match(exactPopup, /trsmt_env_mody_price/);
  assert.match(exactPopup, /goods_stock/);
  assert.match(exactPopup, /trsmt_env_mody_opt/);
  assert.match(exactPopup, /selectRadio\("trsmt_env_mody_opt", "1"\)/);
  assert.match(exactPopup, /commerce-os-a21-v024-main-submit-request/);
  assert.match(mainBridge, /typeof window\.goods_mallMdfy_submit_sp !== "function"/);
  assert.match(mainBridge, /window\.goods_mallMdfy_submit_sp\(\)/);
  assert.match(mainBridge, /수정전송\\s\*할\\s\*상품을\\s\*선택하셨습니까/);
  assert.match(mainBridge, /배송정보.*수정되지/);
  assert.match(mainBridge, /unexpected_confirm/);
  assert.match(mainBridge, /unexpected_alert/);
});

test("A21 v0.2.4 serializes jobs and tracks result tabs after popup close or navigation", () => {
  assert.match(backgroundBase, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
  assert.match(backgroundBase, /A21_POPUP_CLAIM_V020/);
  assert.match(backgroundBase, /baselinePopupTabIds/);
  assert.match(backgroundTracker, /importScripts\("background-v020\.js"\)/);
  assert.match(backgroundTracker, /monitorResult = monitorResultV024/);
  assert.match(backgroundTracker, /onCreatedNavigationTarget/);
  assert.match(backgroundTracker, /onCommitted/);
  assert.match(backgroundTracker, /chrome\.tabs\.onRemoved/);
  assert.match(backgroundTracker, /송신창 닫힘 감지/);
  assert.match(backgroundTracker, /V024_RESULT_TIMEOUT/);
  assert.doesNotMatch(backgroundTracker, /V020_RESULT_WINDOW_CLOSED/);
});

test("A21 v0.2.4 still requires independent Shopling success or failure evidence", () => {
  assert.match(backgroundBase, /inspectResult/);
  assert.match(backgroundBase, /성공건수/);
  assert.match(backgroundBase, /실패건수/);
  assert.match(backgroundTracker, /inspectResult\(tabId\)/);
  assert.match(backgroundTracker, /completeJob/);
  assert.match(backgroundTracker, /failJob/);
  assert.match(backgroundTracker, /180초/);
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
  assert.match(downloadRoute, /const VERSION = "0\.2\.4"/);
  assert.match(downloadRoute, /legacy_about_blank_injection_forbidden/);
  assert.match(downloadRoute, /background-v020\.js/);
  assert.match(downloadRoute, /background-v024\.js/);
  assert.match(downloadRoute, /main-a21-v024\.js/);
  assert.match(downloadRoute, /content-a21-v024\.js/);
  assert.match(downloadRoute, /popup-run\.html/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

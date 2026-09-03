import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../public/shopling-a21-price-option-resend/", import.meta.url);
const [manifestText, popupRun, popupRunHtml, exactPopup, mainBridge, backgroundBase, backgroundTrackerV024, backgroundTrackerV025, planRoute, downloadRoute] = await Promise.all([
  readFile(new URL("manifest.json", root), "utf8"),
  readFile(new URL("popup-run.js", root), "utf8"),
  readFile(new URL("popup-run.html", root), "utf8"),
  readFile(new URL("content-a21-v024.js", root), "utf8"),
  readFile(new URL("main-a21-v024.js", root), "utf8"),
  readFile(new URL("background-v020.js", root), "utf8"),
  readFile(new URL("background-v024.js", root), "utf8"),
  readFile(new URL("background-v025.js", root), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/plan/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shopling-a21-price-option-resend/download/route.ts", import.meta.url), "utf8"),
]);

test("A21 v0.2.5 loads the all-market result aggregator while preserving v0.2.4 send guards", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, "0.2.5");
  assert.equal(manifest.background.service_worker, "background-v025.js");
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
  assert.match(popupRunHtml, /모든 쇼핑몰 결과 합산 검증/);
  assert.match(popupRunHtml, /1 GOODSKEY 안전 테스트/);
  assert.match(popupRun, /v0\.2\.5/);
});

test("A21 v0.2.5 preserves delivery unchanged and price-option isolation", () => {
  for (const source of [exactPopup, mainBridge]) {
    assert.match(source, /trsmt_env_mody_dlvyinfo/);
    assert.match(source, /수정\\s\*안함|수정안함/);
    assert.match(source, /dlvy_notice/);
    assert.match(source, /forceDeliveryUnchanged/);
  }
  assert.match(exactPopup, /tsmt_sale_price_tp/);
  assert.match(exactPopup, /trsmt_env_mody_price/);
  assert.match(exactPopup, /goods_stock/);
  assert.match(exactPopup, /trsmt_env_mody_opt/);
  assert.match(mainBridge, /window\.goods_mallMdfy_submit_sp\(\)/);
});

test("A21 v0.2.5 remains serial and builds a run-level Shopling baseline", () => {
  assert.match(backgroundBase, /if \(state\.jobs\.some\(\(job\) => job\.status === "RUNNING"\)\) return/);
  assert.match(backgroundTrackerV024, /monitorResult = monitorResultV024/);
  assert.match(backgroundTrackerV025, /importScripts\("background-v024\.js"\)/);
  assert.match(backgroundTrackerV025, /runBaselineShoplingTabIds/);
  assert.match(backgroundTrackerV025, /A21_START/);
  assert.match(backgroundTrackerV025, /GROUP_MALLS/);
  assert.match(backgroundTrackerV025, /expectedResultSectionCount/);
});

test("A21 v0.2.5 aggregates every market block and reports concrete partial failures", () => {
  assert.match(backgroundTrackerV025, /쇼핑몰명\\s\*\\\(ID\\\)/);
  assert.match(backgroundTrackerV025, /총건수/);
  assert.match(backgroundTrackerV025, /성공건수/);
  assert.match(backgroundTrackerV025, /실패건수/);
  assert.match(backgroundTrackerV025, /sections\.reduce/);
  assert.match(backgroundTrackerV025, /failureSummary/);
  assert.match(backgroundTrackerV025, /V025_RESULT_PARTIAL_FAILURE/);
  assert.match(backgroundTrackerV025, /소비자가/);
});

test("A21 v0.2.5 scans new Shopling tabs and all frames instead of trusting one popup", () => {
  assert.match(backgroundTrackerV025, /chrome\.tabs\.query/);
  assert.match(backgroundTrackerV025, /candidateTabs/);
  assert.match(backgroundTrackerV025, /executeAllFrames/);
  assert.match(backgroundTrackerV025, /chrome\.tabs\.onCreated/);
  assert.match(backgroundTrackerV025, /monitorResult = monitorResultV025/);
  assert.match(backgroundTrackerV025, /V025_RESULT_TIMEOUT/);
  assert.doesNotMatch(backgroundTrackerV025, /V020_RESULT_WINDOW_CLOSED/);
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
  assert.match(downloadRoute, /const VERSION = "0\.2\.5"/);
  assert.match(downloadRoute, /background-v020\.js/);
  assert.match(downloadRoute, /background-v024\.js/);
  assert.match(downloadRoute, /background-v025\.js/);
  assert.match(downloadRoute, /main-a21-v024\.js/);
  assert.match(downloadRoute, /content-a21-v024\.js/);
  assert.match(downloadRoute, /shopling_a21_resend_manifest_version_mismatch/);
});

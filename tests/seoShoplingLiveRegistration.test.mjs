import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const liveLib = readFileSync("src/lib/seoShoplingLiveRegistration.ts", "utf8");
const liveRoute = readFileSync("src/app/api/seo-title-dispatch/live-register/route.ts", "utf8");
const callback = readFileSync("src/lib/seoShoplingUploadCallback.ts", "utf8");
const uploadCallbackRoute = readFileSync("src/app/api/product-launch-tracker/upload-jobs/[jobId]/route.ts", "utf8");
const cron = readFileSync("src/app/api/cron/seo-shopling-live-registration/route.ts", "utf8");
const ui = readFileSync("src/app/shopling-seo-dispatch/ShoplingSeoLiveDispatchCenter.tsx", "utf8");
const page = readFileSync("src/app/shopling-seo-dispatch/page.tsx", "utf8");
const moduleSource = readFileSync("src/lib/shoplingSeoDispatchModule.ts", "utf8");
const vercel = readFileSync("vercel.json", "utf8");

test("one user action is hard-limited to one full-market round and 29 title reservations", () => {
  assert.match(liveLib, /SEO_SHOPLING_LIVE_ROUNDS_PER_RUN = 1/);
  assert.match(liveRoute, /registration_rounds: 1/);
  assert.match(liveRoute, /reserved\.length !== SEO_TITLE_FULL_MARKET_SIZE/);
  assert.match(liveRoute, /전체몰 1회분 상품명 재고 29개가 부족합니다/);
  assert.match(ui, /전체몰 1회 · 상품명 29개/);
  assert.match(ui, /실제 샵플링 등록 1회/);
  assert.doesNotMatch(ui, /이번 전체몰 출고 횟수/);
});

test("repeated registrations never overwrite canonical six goods keys", () => {
  assert.match(liveRoute, /canonicalMode === "complete" && usedCount === 0/);
  assert.match(liveRoute, /"apply_existing_first"/);
  assert.match(liveRoute, /"canonical_seed"/);
  assert.match(liveRoute, /"additional_registration"/);
  assert.match(liveRoute, /SHOPLING_CANONICAL_PARTIAL/);
  assert.match(liveLib, /buildSeoShoplingRepeatedPtnGoodsCd/);
  assert.match(liveLib, /-S\$\{token\}\$\{channelSuffix\}/);
  assert.match(uploadCallbackRoute, /if \(seoBulk\.canonicalSeed && input\.status === "success"\)/);
  assert.doesNotMatch(uploadCallbackRoute, /if \(seoBulk\) \{\s*await applyResultToTrackerState/);
});

test("six base products are followed by 29 mall title and common-search writes", () => {
  assert.match(liveLib, /createSeoShoplingProductUploadJob/);
  assert.match(liveLib, /shopling-product-launch-upload\.yml/);
  assert.match(callback, /extractSeoShoplingGoodsKeys/);
  assert.match(callback, /dispatchSeoShoplingDirectApply/);
  assert.match(liveLib, /plan\.length !== 29/);
  assert.match(liveLib, /final_site_srch: finalSiteSrch/);
  assert.match(liveLib, /final_title: finalTitle/);
});

test("titles are consumed only after strict direct-apply success and uncertain results go to review", () => {
  assert.match(liveLib, /direct_apply_completed === true/);
  assert.match(liveLib, /Number\(summary\.applied_item_count\) === expectedItems/);
  assert.match(liveLib, /Number\(summary\.failed_item_count\) === 0/);
  assert.match(cron, /p_success: true/);
  assert.match(cron, /verifiedItemCount: 29/);
  assert.match(cron, /p_success: false/);
  assert.match(cron, /phase: "review_required"/);
  assert.match(callback, /finalize_seo_title_reservation/);
  assert.match(callback, /p_success: false/);
});

test("server-side reconciliation is low load and continues after the browser closes", () => {
  assert.match(cron, /VERCEL_ENV !== "production"/);
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /MAX_ACTIVE_DISPATCHES = 5/);
  assert.match(cron, /fetchKeywordShoplingDirectApplyResult/);
  assert.match(vercel, /\/api\/cron\/seo-shopling-live-registration/);
  assert.match(vercel, /"schedule": "\* \* \* \* \*"/);
  assert.doesNotMatch(cron, /setInterval|MutationObserver/);
});

test("the live UI requires explicit confirmation and replaces the old preview-only center", () => {
  assert.match(ui, /window\.confirm/);
  assert.match(ui, /이 작업은 실제 외부 쓰기입니다/);
  assert.match(ui, /\/api\/seo-title-dispatch\/live-register/);
  assert.match(ui, /review_count > 0/);
  assert.match(ui, /recent\?\.status === "submitted"/);
  assert.match(page, /ShoplingSeoLiveDispatchCenter/);
  assert.doesNotMatch(page, /ShoplingSeoDispatchCenter/);
  assert.match(moduleSource, /실제 등록/);
  assert.match(moduleSource, /기존 기준 goods_key를 덮어쓰지 않습니다/);
});

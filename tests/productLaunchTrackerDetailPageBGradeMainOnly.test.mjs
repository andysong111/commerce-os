import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [callbackRoute, adapter, app] = await Promise.all([
  readFile(
    "src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/b-grade-main-only-callback/route.ts",
    "utf8",
  ),
  readFile(
    "public/product-launch-tracker-app/detail-page-bgrade-main-only-dock.js",
    "utf8",
  ),
  readFile("public/product-launch-tracker-app/app.js", "utf8"),
]);

test("B-grade main-only completion keeps detail + one main image and suppresses additional images", () => {
  assert.match(callbackRoute, /bGradeMainOnly: true/);
  assert.match(callbackRoute, /bGradeAdditionalImagesSuppressed: true/);
  assert.match(callbackRoute, /representatives: \[\]/);
  assert.match(callbackRoute, /additionalImageUrls: \[\]/);
  assert.match(callbackRoute, /mode: "main-only-v1"/);
  assert.match(callbackRoute, /publishedCount: 1/);
  assert.match(callbackRoute, /additionalCount: 0/);
});

test("main-only callback preserves durable auth and execution fencing", () => {
  assert.match(callbackRoute, /verifyDetailPageJobToken/);
  assert.match(callbackRoute, /matchesDetailPageExecution/);
  assert.match(callbackRoute, /DETAIL_PAGE_EXECUTION_STALE/);
  assert.match(callbackRoute, /isOwnedAssetUrl/);
  assert.match(callbackRoute, /forwardToParentCallback/);
});

test("product launch tracker docks B-grade main-only success without requiring four sub images", () => {
  assert.match(adapter, /job\?\.result\?\.bGradeMainOnly !== true/);
  assert.match(adapter, /additionalImageUrls: \[\]/);
  assert.match(adapter, /B급 대표이미지 1장과 상세페이지 도킹 완료/);
  assert.match(adapter, /부가이미지 미생성/);
  assert.match(app, /detail-page-bgrade-main-only-dock\.js/);
});

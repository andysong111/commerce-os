import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  new URL(
    "../src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/representative-images/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const control = readFileSync(
  new URL(
    "../src/components/detail-page-ai-review/DetailPageRepresentativeDownloadControl.tsx",
    import.meta.url,
  ),
  "utf8",
);
const page = readFileSync(
  new URL("../src/app/detail-page-ai-review/page.tsx", import.meta.url),
  "utf8",
);

test("representative ZIP API uses the canonical review asset resolver", () => {
  assert.match(route, /detailPageReviewAssets\(/);
  assert.match(route, /publicDetailPageJob\(job\)/);
  assert.match(route, /\.representatives\.slice\(0, MAX_REPRESENTATIVE_IMAGES\)/);
  assert.doesNotMatch(route, /representatives\.length === 5/);
});

test("representative ZIP API only fetches owned product-launch assets", () => {
  assert.match(route, /product-launch-assets/);
  assert.match(route, /url\.origin === ownedPrefix\.origin/);
  assert.match(route, /url\.pathname\.startsWith\(ownedPrefix\.pathname\)/);
  assert.match(route, /DETAIL_PAGE_REPRESENTATIVE_DOWNLOAD_FAILED/);
});

test("representative ZIP API preserves already-compressed image bytes", () => {
  assert.match(route, /zipSync\(files, \{ level: 0 \}\)/);
  assert.match(route, /01_main/);
  assert.match(route, /sub_/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /application\/zip/);
});

test("review page exposes one-click representative ZIP download for any stored image count", () => {
  assert.match(page, /DetailPageRepresentativeDownloadControl/);
  assert.match(control, /대표·부가 이미지 일괄 다운로드/);
  assert.match(control, /detailPageReviewAssets\(job\)\.representatives\.length > 0/);
  assert.match(control, /대표·부가 \{representativeCount\}장 ZIP 다운로드/);
  assert.match(control, /\/representative-images/);
});

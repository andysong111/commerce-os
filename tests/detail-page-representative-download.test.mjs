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

test("full ZIP API uses the canonical review asset resolver for representative and final detail images", () => {
  assert.match(route, /detailPageReviewAssets\(publicDetailPageJob\(job\)\)/);
  assert.match(route, /reviewAssets\.representatives\.slice/);
  assert.match(route, /reviewAssets\.detail\[0\]/);
  assert.match(route, /detail_page/);
  assert.doesNotMatch(route, /representatives\.length === 5/);
});

test("full ZIP API only fetches owned product-launch assets", () => {
  assert.match(route, /product-launch-assets/);
  assert.match(route, /url\.origin === ownedPrefix\.origin/);
  assert.match(route, /url\.pathname\.startsWith\(ownedPrefix\.pathname\)/);
  assert.match(route, /DETAIL_PAGE_FULL_IMAGE_DOWNLOAD_FAILED/);
});

test("full ZIP API preserves already-compressed image bytes and appends the detail page", () => {
  assert.match(route, /zipSync\(files, \{ level: 0 \}\)/);
  assert.match(route, /representativeFilenameBase/);
  assert.match(route, /_main/);
  assert.match(route, /_sub_/);
  assert.match(route, /_detail_page/);
  assert.match(route, /-all-images\.zip/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /application\/zip/);
});

test("review page exposes one-click representative, sub and final detail-page ZIP download", () => {
  assert.match(page, /DetailPageRepresentativeDownloadControl/);
  assert.match(control, /대표 부가 상세페이지 전체 ZIP 다운로드/);
  assert.match(control, /assets\.representatives\.length > 0 && assets\.detail\.length > 0/);
  assert.match(control, /대표·부가 \{count\}장 \+ 상세페이지/);
  assert.match(control, /최종 상세페이지 이미지까지 총 \$\{totalImageCount\}장/);
  assert.match(control, /\/representative-images/);
});

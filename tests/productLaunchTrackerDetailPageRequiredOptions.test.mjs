import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const trackerEntry = await readFile(
  new URL(
    "../public/product-launch-tracker-app/app.js",
    import.meta.url,
  ),
  "utf8",
);
const optionGuard = await readFile(
  new URL(
    "../public/product-launch-tracker-app/detail-page-option-guard.js",
    import.meta.url,
  ),
  "utf8",
);
const detailPageDock = await readFile(
  new URL(
    "../public/product-launch-tracker-app/detail-page-dock.js",
    import.meta.url,
  ),
  "utf8",
);
const jobsRoute = await readFile(
  new URL(
    "../src/app/api/product-launch-tracker/detail-page-jobs/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("product-launch option cells visibly warn when empty", () => {
  assert.match(trackerEntry, /detail-page-option-guard\.js/);
  assert.match(optionGuard, /옵션란이 비어있습니다/);
  assert.match(optionGuard, /inline-options-editor/);
  assert.match(optionGuard, /detail-page-option-required-warning/);
  assert.match(optionGuard, /aria-invalid/);
  assert.match(optionGuard, /focus\(\{ preventScroll: false \}\)/);
});

test("selected products with empty options cannot start detail-page generation", () => {
  assert.match(optionGuard, /selectedMissingRows\(\)/);
  assert.match(optionGuard, /button\.disabled = true/);
  assert.match(optionGuard, /옵션 입력 필요/);
  assert.match(optionGuard, /event\.preventDefault\(\)/);
  assert.match(optionGuard, /event\.stopImmediatePropagation\(\)/);
});

test("launch options are the single source passed into the detail-page job", () => {
  assert.match(detailPageDock, /salesOptions: readSalesOptions\(item\)/);
  assert.match(detailPageDock, /option\?\.saleOption/);
  assert.match(jobsRoute, /sales_options: input\.salesOptions/);
});

test("the server rejects optionless detail-page jobs even if the browser guard is bypassed", () => {
  assert.match(jobsRoute, /if \(!input\.salesOptions\)/);
  assert.match(jobsRoute, /DETAIL_PAGE_SALES_OPTIONS_REQUIRED/);
  assert.match(jobsRoute, /옵션란이 비어있습니다/);
  assert.match(jobsRoute, /status: 400/);
});

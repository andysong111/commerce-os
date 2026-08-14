import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [loader, extension, page] = await Promise.all([
  readFile("public/product-launch-tracker-app/app.js", "utf8"),
  readFile(
    "public/product-launch-tracker-app/optimized-china-order-mapping.js",
    "utf8",
  ),
  readFile("src/app/product-launch-tracker/page.tsx", "utf8"),
]);

test("optimized product-launch path loads the B-code China option extension", () => {
  assert.match(loader, /await import\("\.\/optimized-app\.js"\)/);
  assert.match(
    loader,
    /await import\("\.\/optimized-china-order-mapping\.js"\)/,
  );
  assert.match(
    loader,
    /await import\("\.\/model-bcode-option-guard\.js"\)/,
  );
  assert.match(page, /20260812-authoritative-model-bcodes-v1/);
});

test("active product detail stores only B-code China option while model fixed first link stays product-owned", () => {
  assert.match(extension, /B-code별 중국옵션/);
  assert.match(extension, /data-optimized-china-order-map-row/);
  assert.match(extension, /data-optimized-china-order-option-input/);
  assert.doesNotMatch(extension, /data-optimized-china-order-link-select/);
  assert.match(extension, /고정 1번 중국 상품링크/);
  assert.match(extension, /readChinaOrderOptionMappings/);
});

test("China option mapping persists only after the optimized main product save closes successfully", () => {
  assert.match(extension, /captureBeforeSave/);
  assert.match(extension, /waitForMainSave/);
  assert.match(extension, /if \(detailDialog\?\.open\)/);
  assert.match(extension, /applyChinaOrderOptionMappings/);
  assert.match(extension, /operation: "patch_item"/);
  assert.match(extension, /patch: \{ orderOptions: next\.orderOptions \}/);
});

test("mapping never changes fixed B-code sale options or exposes per-B-code link selection", () => {
  assert.doesNotMatch(extension, /patch:\s*\{[^}]*saleOption/s);
  assert.doesNotMatch(extension, /supplierLink:/);
  assert.doesNotMatch(extension, /placeOrder|payOrder|checkout|fetch\([^)]*1688/i);
});

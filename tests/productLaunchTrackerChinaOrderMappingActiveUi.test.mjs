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

test("optimized product-launch path loads the B-code China order mapping extension", () => {
  assert.match(loader, /await import\("\.\/optimized-app\.js"\)/);
  assert.match(
    loader,
    /await import\("\.\/optimized-china-order-mapping\.js"\)/,
  );
  assert.match(page, /20260811-china-order-map-v2/);
});

test("active product detail mounts B-code fixed sale options with China link and option inputs", () => {
  assert.match(extension, /B-code별 중국 주문 매핑/);
  assert.match(extension, /data-optimized-china-order-map-row/);
  assert.match(extension, /data-optimized-china-order-link-select/);
  assert.match(extension, /data-optimized-china-order-option-input/);
  assert.match(extension, /판매옵션은 B-code 기준값/);
  assert.match(extension, /readChinaOrderOptionMappings/);
});

test("mapping persists only after the optimized main product save closes successfully", () => {
  assert.match(extension, /captureBeforeSave/);
  assert.match(extension, /waitForMainSave/);
  assert.match(extension, /if \(detailDialog\?\.open\)/);
  assert.match(extension, /applyChinaOrderOptionMappings/);
  assert.match(extension, /operation: "patch_item"/);
  assert.match(extension, /patch: \{ orderOptions: next\.orderOptions \}/);
});

test("mapping never changes fixed B-code sale options or calls external order APIs", () => {
  assert.doesNotMatch(extension, /patch:\s*\{[^}]*saleOption/s);
  assert.doesNotMatch(extension, /placeOrder|payOrder|checkout|fetch\([^)]*1688/i);
});

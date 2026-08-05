import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appPath = fileURLToPath(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
);
const visibilityPath = fileURLToPath(
  new URL(
    "../public/product-launch-tracker-app/multi-option-main-barcode-visibility.js",
    import.meta.url,
  ),
);

const appSource = await readFile(appPath, "utf8");
const visibilitySource = await readFile(visibilityPath, "utf8");

test("multi-option main barcode visibility module is valid JavaScript", () => {
  execFileSync(process.execPath, ["--check", visibilityPath]);
});

test("main barcode input is hidden only when two or more actual options exist", () => {
  assert.match(visibilitySource, /const actualOptionCount =/);
  assert.match(visibilitySource, /String\(option\?\.saleOption \?\? ""\)\.trim\(\)/);
  assert.match(visibilitySource, /const usesOptionLocationOnly = actualOptionCount >= 2/);
  assert.match(visibilitySource, /barcodeInput\.hidden = usesOptionLocationOnly/);
  assert.match(
    visibilitySource,
    /barcodeCell\.classList\.toggle\("uses-option-location-only", usesOptionLocationOnly\)/,
  );
});

test("visibility change preserves the stored main barcode value", () => {
  assert.doesNotMatch(visibilitySource, /localStorage\.setItem/);
  assert.doesNotMatch(visibilitySource, /barcodeInput\.value\s*=/);
  assert.doesNotMatch(visibilitySource, /barcode:\s*""/);
});

test("standalone tracker loads the visibility module after option location rendering", () => {
  assert.match(
    appSource,
    /await import\("\.\/multi-option-main-barcode-visibility\.js"\)/,
  );
  assert.ok(
    appSource.indexOf('await import("./option-location-inline-editor.js")') <
      appSource.indexOf('await import("./multi-option-main-barcode-visibility.js")'),
  );
});

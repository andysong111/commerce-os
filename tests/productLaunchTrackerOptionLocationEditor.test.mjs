import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editorSource = await readFile(
  new URL(
    "../public/product-launch-tracker-app/option-location-inline-editor.js",
    import.meta.url,
  ),
  "utf8",
);
const entrySource = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);

test("comma-separated options expose one blank location-code editor per option", () => {
  assert.match(editorSource, /Array\.isArray\(item\.orderOptions\)/);
  assert.match(editorSource, /option\?\.saleOption/);
  assert.match(editorSource, /inline-option-location-input/);
  assert.match(editorSource, /data-empty/);
  assert.doesNotMatch(editorSource, /input\.placeholder\s*=/);
});

test("location codes update the existing option barcode field without replacing option data", () => {
  assert.match(editorSource, /\.\.\.options\[targetIndex\]/);
  assert.match(editorSource, /barcode: nextCode/);
  assert.match(editorSource, /orderOptions: options/);
  assert.match(editorSource, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(editorSource, /product-launch-tracker:external-state/);
});

test("product launch tracker loads the option location editor only in the standalone UI", () => {
  assert.match(
    entrySource,
    /else \{[\s\S]*await import\("\.\/option-location-inline-editor\.js"\);/,
  );
  assert.doesNotMatch(
    entrySource.split("} else {")[0],
    /option-location-inline-editor/,
  );
});

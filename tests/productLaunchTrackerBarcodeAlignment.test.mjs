import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const editorPath = fileURLToPath(
  new URL(
    "../public/product-launch-tracker-app/option-location-inline-editor.js",
    import.meta.url,
  ),
);
const editorSource = await readFile(editorPath, "utf8");

test("barcode alignment module is valid JavaScript", () => {
  execFileSync(process.execPath, ["--check", editorPath]);
});

test("main and option barcode inputs use the left edge", () => {
  assert.match(editorSource, /\[data-column-key="barcode"\] > \.barcode-input/);
  assert.match(editorSource, /margin-left: 0/);
  assert.match(editorSource, /margin-right: auto/);
  assert.match(editorSource, /\.inline-option-location-list[\s\S]*justify-items: start/);
  assert.match(editorSource, /\.inline-option-location-input[\s\S]*justify-self: start/);
});

test("option location input is rendered before its option label", () => {
  assert.match(
    editorSource,
    /grid-template-columns: minmax\(94px, 112px\) minmax\(120px, 1fr\)/,
  );
  assert.match(editorSource, /optionRow\.append\(input, label\)/);
  assert.doesNotMatch(editorSource, /optionRow\.append\(label, input\)/);
});

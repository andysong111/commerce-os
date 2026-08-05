import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appEntry = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);
const cleanup = await readFile(
  new URL(
    "../public/product-launch-tracker-app/empty-cell-placeholder-cleanup.js",
    import.meta.url,
  ),
  "utf8",
);

test("launch tracker loads empty-cell placeholder cleanup in standalone mode", () => {
  assert.match(appEntry, /empty-cell-placeholder-cleanup\.js/);
});

test("empty launch table editors show no example text", () => {
  assert.match(cleanup, /\.barcode-input/);
  assert.match(cleanup, /\.inline-category-editor/);
  assert.match(cleanup, /\.inline-options-editor/);
  assert.match(cleanup, /removeAttribute\("placeholder"\)/);
  assert.match(cleanup, /MutationObserver/);
});

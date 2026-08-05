import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appPath = fileURLToPath(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
);
const locationEditorPath = fileURLToPath(
  new URL(
    "../public/product-launch-tracker-app/option-location-inline-editor.js",
    import.meta.url,
  ),
);
const smoothSavePath = fileURLToPath(
  new URL(
    "../public/product-launch-tracker-app/inline-save-no-flicker.js",
    import.meta.url,
  ),
);

const appSource = await readFile(appPath, "utf8");
const locationEditorSource = await readFile(locationEditorPath, "utf8");
const smoothSaveSource = await readFile(smoothSavePath, "utf8");

test("product launch public modules are valid JavaScript", () => {
  execFileSync(process.execPath, ["--check", locationEditorPath]);
  execFileSync(process.execPath, ["--check", smoothSavePath]);
});

test("per-option location inputs render under the reference barcode column", () => {
  assert.match(
    locationEditorSource,
    /const cell = row\.querySelector\("\[data-column-key='barcode'\]"\)/,
  );
  assert.match(locationEditorSource, /\[data-column-key="barcode"\] \{/);
  assert.match(locationEditorSource, /input\.dataset\.optionId = optionId/);
  assert.doesNotMatch(
    locationEditorSource,
    /const cell = row\.querySelector\("\[data-column-key='options'\]"\)/,
  );
});

test("single-option products do not render separate option location inputs", () => {
  assert.match(locationEditorSource, /if \(optionEntries\.length < 2\) \{/);
  assert.match(locationEditorSource, /container\?\.remove\(\);/);
});

test("inline autosave waits for blur or Enter instead of saving during a typing pause", () => {
  assert.match(
    smoothSaveSource,
    /document\.addEventListener\("input", handleInlineInput, true\)/,
  );
  assert.match(
    smoothSaveSource,
    /document\.addEventListener\("change", handleInlineCommit, true\)/,
  );
  assert.match(
    smoothSaveSource,
    /document\.addEventListener\("keydown", handleInlineKeydown, true\)/,
  );
  assert.match(smoothSaveSource, /event\.key !== "Enter"/);
  assert.match(smoothSaveSource, /commitInlineChange\(input\)/);
  assert.doesNotMatch(smoothSaveSource, /setTimeout\([^)]*commitInlineChange/);
});

test("all editable identity and option fields use the no-flicker save path", () => {
  for (const className of [
    "barcode-input",
    "inline-model-number-editor",
    "inline-product-name-editor",
    "inline-category-editor",
    "inline-options-editor",
    "inline-option-location-input",
  ]) {
    assert.match(smoothSaveSource, new RegExp(`\\.${className}`));
  }
  assert.match(smoothSaveSource, /event\.preventDefault\(\)/);
  assert.match(smoothSaveSource, /event\.stopImmediatePropagation\(\)/);
});

test("inline saves update storage and main state without replacing the visible table", () => {
  assert.match(
    smoothSaveSource,
    /localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(nextState\)\)/,
  );
  assert.match(smoothSaveSource, /Object\.defineProperty\(tableBody, "innerHTML"/);
  assert.match(smoothSaveSource, /suppressTableRender: true/);
  assert.match(smoothSaveSource, /typingGuardBypass: true/);
  assert.match(smoothSaveSource, /applyInlineOptionLabels\(item\?\.orderOptions, labels\)/);
  assert.doesNotMatch(smoothSaveSource, /window\.location\.reload/);
});

test("standalone tracker loads the location editor and no-flicker save controller", () => {
  assert.match(appSource, /await import\("\.\/option-location-inline-editor\.js"\)/);
  assert.match(appSource, /await import\("\.\/inline-save-no-flicker\.js"\)/);
  assert.ok(
    appSource.indexOf('await import("./option-location-inline-editor.js")') <
      appSource.indexOf('await import("./inline-save-no-flicker.js")'),
  );
});

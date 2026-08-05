import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const bootstrapPath = fileURLToPath(
  new URL("../public/product-launch-tracker-app/bootstrap.js", import.meta.url),
);
const bootstrapSource = await readFile(bootstrapPath, "utf8");

test("tracker bootstrap remains valid JavaScript", () => {
  execFileSync(process.execPath, ["--check", bootstrapPath]);
});

test("typing guard is installed before the tracker app registers render listeners", () => {
  assert.match(bootstrapSource, /installTrackerEditingGuard\(\);/);
  assert.match(bootstrapSource, /await import\("\.\/main-app\.js"\)/);
  assert.ok(
    bootstrapSource.indexOf("installTrackerEditingGuard();") <
      bootstrapSource.indexOf('await import("./main-app.js")'),
  );
});

test("background external-state renders are deferred while a tracker input is active", () => {
  assert.match(bootstrapSource, /const EXTERNAL_STATE_EVENT = "product-launch-tracker:external-state"/);
  assert.match(bootstrapSource, /window\.addEventListener\([\s\S]*EXTERNAL_STATE_EVENT/);
  assert.match(bootstrapSource, /event\.stopImmediatePropagation\(\)/);
  assert.match(bootstrapSource, /deferredExternalState = true/);
  assert.match(bootstrapSource, /flushDeferredExternalState\(\)/);
  assert.match(bootstrapSource, /typingGuardBypass: true/);
});

test("typing remains active through pauses and only releases after focus leaves the editors", () => {
  assert.match(bootstrapSource, /document\.addEventListener\([\s\S]*"focusin"/);
  assert.match(bootstrapSource, /document\.addEventListener\([\s\S]*"input"/);
  assert.match(bootstrapSource, /document\.addEventListener\([\s\S]*"focusout"/);
  assert.match(bootstrapSource, /EDIT_RELEASE_DELAY_MS = 220/);
  assert.match(bootstrapSource, /isTrackerEditable\(document\.activeElement\)/);
  assert.doesNotMatch(bootstrapSource, /setInterval\([^)]*flushDeferredExternalState/);
});

test("Korean IME composition Enter does not blur or save the input prematurely", () => {
  assert.match(bootstrapSource, /"compositionstart"/);
  assert.match(bootstrapSource, /"compositionend"/);
  assert.match(bootstrapSource, /event\.isComposing \|\| composingText \|\| event\.keyCode === 229/);
  assert.match(bootstrapSource, /event\.stopImmediatePropagation\(\)/);
});

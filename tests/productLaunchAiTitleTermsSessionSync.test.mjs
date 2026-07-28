import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath =
  "src/components/product-launch-flow/ProductLaunchAiTitleTermsPanel.tsx";

test("AI title panel synchronizes new and updated launch sessions without reload", async () => {
  const source = await readFile(componentPath, "utf8");
  assert.match(source, /SESSION_SYNC_MS = 1_000/);
  assert.match(source, /window\.setInterval\(syncSession, SESSION_SYNC_MS\)/);
  assert.match(source, /window\.addEventListener\("focus", syncSession\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibility\)/);
  assert.match(source, /readProductLaunchSimpleSession\(window\.localStorage\)/);
  assert.match(source, /contextFingerprint/);
  assert.match(source, /setContexts\(nextContexts\)/);
  assert.match(source, /setCurrentTitles/);
  assert.doesNotMatch(source, /window\.location\.reload/);
});

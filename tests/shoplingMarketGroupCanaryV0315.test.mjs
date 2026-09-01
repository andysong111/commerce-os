import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0315/download/route.ts", import.meta.url);

test("v0.3.15 reinjects result tabs and migrates v0.3.14 runtime state", async () => {
  const source = await readFile(packageRoute, "utf8");
  for (const needle of [
    'const VERSION = "0.3.15"',
    'LEGACY_WORKER_META_KEY',
    'chrome.tabs.onUpdated.addListener',
    'chrome.scripting.executeScript',
    'migrateLegacyRuntimeState',
    'migrateLegacyPopupState',
    'state.stage === "submit_armed"',
    'RESILIENT RESULT RECOVERY',
  ]) {
    assert.equal(source.includes(needle), true, `missing ${needle}`);
  }
});

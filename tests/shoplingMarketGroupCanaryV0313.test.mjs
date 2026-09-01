import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0313/download/route.ts", import.meta.url);

test("v0.3.13 packages a no-reload all-frame injector and lets the A18 frame coordinate", async () => {
  const source = await readFile(packageRoute, "utf8");
  for (const needle of [
    'const VERSION = "0.3.13"',
    '"scripting"',
    'chrome.scripting.executeScript',
    'target: { tabId: tab.id, allFrames: true }',
    'content-group-canary.mjs',
    'navigateControlToA18ForIntent',
    'navigationRequestedAt',
    '__commerceOsShoplingMarketSenderV0313',
    'if (context.worker) return',
    'NO-RELOAD A18 FRAME INJECTOR',
  ]) {
    assert.equal(source.includes(needle), true, `missing ${needle}`);
  }
});

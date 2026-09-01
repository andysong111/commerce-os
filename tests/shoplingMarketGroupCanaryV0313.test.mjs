import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0313/download/route.ts", import.meta.url);

test("v0.3.13 injects the current worker into the active Shopling tab instead of reloading A18", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /const VERSION = "0\.3\.13"/);
  assert.match(source, /"scripting"/);
  assert.match(source, /chrome\.scripting\.executeScript/);
  assert.match(source, /files: \["content-group-canary\.mjs"\]/);
  assert.match(source, /NO-RELOAD A18 INJECTOR/);
});

test("v0.3.13 keeps durable intent and can navigate a Shopling dashboard back to A18", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /status: "pending"/);
  assert.match(source, /navigateControlToA18ForIntent/);
  assert.match(source, /navigationRequestedAt/);
  assert.match(source, /findA18Link/);
  assert.match(source, /dispatchHover/);
});

test("v0.3.13 prevents duplicate manual injection loops", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /__commerceOsShoplingMarketSenderV0313/);
  assert.match(source, /if \(globalThis\.__commerceOsShoplingMarketSenderV0313\) return/);
});

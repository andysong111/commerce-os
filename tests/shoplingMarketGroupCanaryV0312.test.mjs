import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0312/download/route.ts", import.meta.url);

test("v0.3.12 persists selection intent before reloading A18", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /const VERSION = "0\.3\.12"/);
  assert.match(source, /SELECTION_INTENT_KEY/);
  assert.match(source, /status: "pending"/);
  assert.match(source, /await chrome\.storage\.local\.set/);
  assert.match(source, /await chrome\.tabs\.reload\(tab\.id\)/);
});

test("v0.3.12 lets fresh A18 consume a short-lived durable intent without a popup message-port response", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /activateSelectionIntent/);
  assert.match(source, /SELECTION_INTENT_TTL_MS = 90000/);
  assert.match(source, /status: "consumed"/);
  assert.match(source, /popup↔A18 message port/);
  assert.match(source, /상품은 순차 처리하고 각 상품은 도매1~소매2를 최대 3채널씩 3\+3/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0316/download/route.ts", import.meta.url);
const contextRoute = new URL("../src/app/api/shopling-market-group-canary/result/context/route.ts", import.meta.url);

test("v0.3.16 recovers result worker context from the Commerce OS server ledger", async () => {
  const source = await readFile(packageRoute, "utf8");
  for (const needle of [
    'const VERSION = "0.3.16"',
    'RESULT_CONTEXT_API_ENDPOINT',
    'recoverServerWorkerContext',
    'ensureResultWorkerState',
    'serverRecovered: true',
    'shopling-market-result-context-v0.1',
  ]) {
    assert.equal(source.includes(needle), true, `missing ${needle}`);
  }
});

test("result context API only exposes recent submit-armed claimed rows", async () => {
  const source = await readFile(contextRoute, "utf8");
  for (const needle of [
    'const BRIDGE = "shopling-market-result-context-v0.1"',
    '.eq("status", "claimed")',
    '.eq("market_status", "submit_armed")',
    '.not("submit_armed_at", "is", null)',
    'MAX_AGE_MS',
    'candidateGoodsKeys',
  ]) {
    assert.equal(source.includes(needle), true, `missing ${needle}`);
  }
});

test("v0.3.16 preserves safety guardrails", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.equal(source.includes('response.contexts.length !== 1'), true);
  assert.equal(source.includes('candidateGoodsKeys.includes(task.goodsKey)'), true);
  assert.equal(source.includes('document.documentElement.appendChild(box)'), false);
});

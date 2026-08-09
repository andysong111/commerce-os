import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page] = await Promise.all([
  readFile("src/lib/stage8ChinaAuthLayerProbe.ts", "utf8"),
  readFile("src/app/stage8-china-auth-layer-probe/page.tsx", "utf8"),
]);

test("auth probe uses only an intentionally invalid credential on a read-only GET", () => {
  assert.match(engine, /INVALID_PROBE_TOKEN/);
  assert.match(engine, /method: "GET"/);
  assert.match(engine, /confirmed-receipts-by-barcodes/);
  assert.match(engine, /probeBarcode: PROBE_BARCODE/);
  assert.match(engine, /realSecretUsed: false/);
  assert.doesNotMatch(engine, /CHINA_ORDER_MANAGER_INTEGRATION_SECRET|PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET|PRODUCT_MASTER_INTEGRATION_SECRET/);
});

test("probe distinguishes Sites platform sign-in HTML from app integration JSON auth", () => {
  assert.match(engine, /CHATGPT_SITES_PLATFORM_GATE/);
  assert.match(engine, /APP_INTEGRATION_AUTH_REACHED/);
  assert.match(engine, /chatgpt sites - sign in/);
  assert.match(engine, /INVALID_PRICE_ADJUSTMENT_SECRET/);
  assert.match(engine, /PRICE_ADJUSTMENT_SECRET_NOT_CONFIGURED/);
  assert.match(page, /integration secret을 바꾸는 것으로는 해결되지 않습니다/);
});

test("invalid token success is treated as an auth bypass risk", () => {
  assert.match(engine, /response\.ok[\s\S]*AUTH_BYPASS_RISK/);
  assert.match(engine, /실제 데이터는 사용하지 않고 연동을 차단/);
});

test("response body and business state are never exposed or mutated", () => {
  assert.match(engine, /responseBodyExposed: false/);
  assert.match(engine, /businessWritesEnabled: false/);
  assert.match(page, /RESPONSE BODY HIDDEN/);
  assert.match(page, /Business writes/);
  assert.doesNotMatch(engine, /\.(insert|upsert|delete)\(/);
});

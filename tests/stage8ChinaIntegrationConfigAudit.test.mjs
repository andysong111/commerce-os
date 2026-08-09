import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page] = await Promise.all([
  readFile("src/lib/stage8ChinaIntegrationConfigAudit.ts", "utf8"),
  readFile("src/app/stage8-china-integration-config-audit/page.tsx", "utf8"),
]);

test("audit distinguishes an explicit China base override from the ChatGPT Site default", () => {
  assert.match(engine, /DEFAULT_CHINA_ORDER_BASE_URL/);
  assert.match(engine, /CHINA_ORDER_MANAGER_BASE_URL/);
  assert.match(engine, /"ENV_OVERRIDE"/);
  assert.match(engine, /"DEFAULT_CHATGPT_SITE"/);
  assert.match(engine, /hostname\.endsWith\("\.chatgpt\.site"\)/);
});

test("audit exposes only secret-name presence and never secret values", () => {
  assert.match(engine, /CHINA_ORDER_MANAGER_INTEGRATION_SECRET/);
  assert.match(engine, /PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET/);
  assert.match(engine, /PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.match(engine, /configured: Boolean/);
  assert.match(engine, /secretValuesExposed: false/);
  assert.match(page, /Secret values exposed/);
  assert.match(page, /값이나 길이·prefix는 표시하지 않습니다/);
  assert.doesNotMatch(page, /process\.env/);
});

test("default ChatGPT Site plus receipt auth failure recommends a server-to-server base or Access path", () => {
  assert.match(engine, /DEFAULT_CHATGPT_SITE_AUTH_BLOCKED/);
  assert.match(engine, /CHINA_RECEIPT_HISTORY_AUTH/);
  assert.match(engine, /CONFIGURE_NON_SITES_BASE_OR_ACCESS/);
  assert.match(page, /Site 로그인 계층을 거치지 않는 서버간 endpoint 또는 별도 Access 경로/);
});

test("source and config failures remain read only", () => {
  assert.match(engine, /loadChinaConfirmedReceiptCoverage/);
  assert.match(engine, /businessWritesEnabled: false/);
  assert.match(page, /BUSINESS WRITE 0/);
  assert.doesNotMatch(engine, /\.(insert|upsert|delete)\(/);
  assert.doesNotMatch(engine, /process\.env\.[A-Z0-9_]+\s*=/);
});

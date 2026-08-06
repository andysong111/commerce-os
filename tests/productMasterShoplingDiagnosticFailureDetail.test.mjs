import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const service = await readFile(
  new URL("../src/lib/productMasterShoplingDiagnostic.ts", import.meta.url),
  "utf8",
);

test("Shopling failures preserve a bounded safe cause and nested error code", () => {
  assert.match(service, /function safeErrorMessage/);
  assert.match(service, /depth < 4/);
  assert.match(service, /candidate\.cause/);
  assert.match(service, /candidate\.code/);
  assert.match(service, /\.slice\(0, 500\)/);
  assert.match(service, /login_id\|company_id\|api_auth_key/);
  assert.match(service, /\{48,\}/);
});

test("retry events store exact safe reason, range, attempt and chunk size", () => {
  assert.match(
    service,
    /PRODUCT_MASTER_SHOPLING_DIAGNOSTIC_STEP_FAILURE/,
  );
  assert.match(service, /range: nextRange/);
  assert.match(service, /rangeKey: key/);
  assert.match(service, /chunkDays: request\.chunkDays/);
  assert.match(service, /attempt,/);
  assert.match(service, /errorMessage: message/);
});

test("final status exposes the latest safe failure without revealing credentials", () => {
  for (const field of [
    "latestFailureRange",
    "latestFailureAttempt",
    "latestFailureMessage",
  ]) {
    assert.match(service, new RegExp(field));
  }
  assert.match(service, /최근 실제 원인:/);
  assert.doesNotMatch(
    service,
    /latestFailureMessage:\s*process\.env|SHOPLING_API_AUTH_KEY:\s*process\.env/,
  );
});

test("failure evidence never enables Shopling, inventory, price or procurement writes", () => {
  assert.doesNotMatch(service, /method:\s*"(?:PUT|PATCH|DELETE)"/);
  assert.doesNotMatch(service, /shopling-price|price-modify|1688/i);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [service, route] = await Promise.all([
  readFile("src/lib/stage8StocktakeCanaryOperator.ts", "utf8"),
  readFile("src/app/api/stage8/stocktake-canary/route.ts", "utf8"),
]);

test("signed Product Master request is preserved", () => {
  assert.match(service, /createHmac\("sha256", secret\)/);
  assert.match(service, /commerce-os-stocktake-canary-v1/);
  assert.match(service, /x-commerce-os-stocktake-canary-signature/);
});

test("Ops browser proxy has a separate default-off write gate", () => {
  assert.match(service, /OPS_STAGE8_STOCKTAKE_OPERATOR_WRITE_ENABLED === "true"/);
  assert.match(service, /stocktakeOperatorProxyWriteEnabled/);
  assert.match(route, /if \(!stocktakeOperatorProxyWriteEnabled\(\)\)/);
  assert.match(route, /STOCKTAKE_CANARY_OPERATOR_WRITE_GATE_OFF/);
  assert.match(route, /status: 403/);
});

test("operator readiness needs both PM and Ops gates", () => {
  assert.match(service, /bothWriteGatesEnabled = preview\.writeEnabled && opsOperatorWriteEnabled/);
  assert.match(service, /state: bothWriteGatesEnabled \? "READY_FOR_COUNT" : "WRITE_GATE_OFF"/);
  assert.match(service, /opsOperatorWriteEnabled/);
});

test("write scope remains one signed stocktake with no adjacent business writes", () => {
  assert.match(route, /maxWriteRows: 1/);
  assert.match(route, /purchaseWritesEnabled: false/);
  assert.match(route, /priceWritesEnabled: false/);
  assert.match(route, /receiptWritesEnabled: false/);
  assert.match(service, /expectedPlanFingerprint/);
  assert.match(service, /expectedInventoryGuard/);
});

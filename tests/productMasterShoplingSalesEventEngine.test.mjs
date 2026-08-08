import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, monthly] = await Promise.all([
  readFile("src/lib/productMasterShoplingSalesEventEngine.ts", "utf8"),
  readFile("src/lib/productMasterShoplingSalesBackfillEngine.ts", "utf8"),
]);

test("event rows use the same base-unit and paid-amount inputs as the monthly canonical ledger", () => {
  assert.match(engine, /Math\.round\(number\(order\.quantity\)\)\) \* identity\.unitsPerOrder/);
  assert.match(engine, /Math\.round\(number\(order\.paidAmount\)\)/);
  assert.match(monthly, /current\.quantity \+= quantity \* identity\.unitsPerOrder/);
  assert.match(monthly, /current\.revenue \+= Math\.max\(0, number\(order\.paidAmount\)\)/);
});

test("cancelled and returned managed lines are retained as explicit tombstones", () => {
  assert.match(engine, /validSale = validSaleStatus\(order\.status\) && quantity > 0/);
  assert.match(engine, /validSale,/);
  assert.match(engine, /tombstoneRows: events\.length - validRows\.length/);
  assert.match(engine, /취소/);
  assert.match(engine, /반품/);
  assert.match(engine, /환불/);
});

test("exact historical option barcode is evaluated before a later current option identity", () => {
  const optionBarcode = engine.indexOf("const optionBarcode = managedBarcode");
  const optionIdentityReturn = engine.indexOf("if (optionIdentity) return optionIdentity");
  const historicalDirect = engine.indexOf("historicalDirectIdentity(index, optionBarcode, order)");
  assert.ok(optionBarcode >= 0);
  assert.ok(historicalDirect > optionBarcode);
  assert.ok(optionIdentityReturn > historicalDirect);
  assert.match(engine, /historicalByBarcode/);
  assert.match(engine, /ownUnits\.size === 1/);
  assert.match(engine, /ownUnits\.size > 1\) return null/);
});

test("managed B-code scope is preserved and old non-B rows are ignored", () => {
  assert.match(engine, /const MANAGED_BARCODE = \/\^B\[A-Z\]\{2\}\\d\+-\\d\+\$\//);
  assert.match(engine, /if \(!isManagedSalesScope\(index, order, raw\)\)/);
  assert.match(engine, /ignoredRows \+= 1/);
});

test("cross-chunk identity disagreement is surfaced instead of silently overwritten", () => {
  assert.match(engine, /prior\.barcode !== event\.barcode \|\| prior\.occurredAt !== event\.occurredAt/);
  assert.match(engine, /conflicts\.push\(event\.externalId\)/);
  assert.match(engine, /conflictExternalIds/);
});

test("wire contract is pinned to Product Master canonical sales event API", () => {
  assert.match(engine, /commerce-os-sales-events-v1/);
  assert.match(engine, /shopling_orders_event_v1/);
  assert.match(engine, /externalId: order\.id/);
  assert.match(engine, /occurredAt: orderedAt/);
});

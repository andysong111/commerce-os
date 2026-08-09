import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const lib = await readFile("src/lib/historicalReceiptSourceReadiness.ts", "utf8");
const page = await readFile("src/app/stage8-historical-receipt-source/page.tsx", "utf8");

test("historical receipt bridge only reads authenticated source", () => {
  assert.match(lib, /api\/integrations\/price-adjustment-receipts\?limit=5/);
  assert.match(lib, /authorization: `Bearer \$\{secret\}`/);
  assert.match(lib, /method: "GET"/);
  assert.match(lib, /cache: "no-store"/);
  assert.doesNotMatch(lib, /method: "POST"/);
  assert.doesNotMatch(lib, /upsert|insert|update\(/i);
});

test("source must explicitly declare writes disabled", () => {
  assert.match(lib, /sourceWritesEnabled === true/);
  assert.match(lib, /!sourceWritesEnabled/);
  assert.match(lib, /sourceWritesEnabled: false/);
});

test("page does not expose integration secret or receipt payload", () => {
  assert.match(page, /실제 쓰기/);
  assert.match(page, /READ ONLY/);
  assert.doesNotMatch(page, /PRICE_ADJUSTMENT_ENGINE_INTEGRATION_SECRET/);
  assert.doesNotMatch(page, /authorization/i);
  assert.doesNotMatch(page, /receipts\.map|receipt\.barcode|unitCostKrw/);
});

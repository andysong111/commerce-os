import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const integration = await readFile(
  "src/lib/integrations/priceAdjustmentEngine.ts",
  "utf8",
);
const page = await readFile(
  "src/app/price-adjustment-engine/page.tsx",
  "utf8",
);

test("price dashboard reads the Product Master lifecycle snapshot before legacy sources", () => {
  assert.match(integration, /\/api\/integrations\/lifecycle-snapshot/);
  assert.match(integration, /PRODUCT_MASTER_INTEGRATION_SECRET/);
  assert.match(integration, /sourceMode: "product_master_lifecycle"/);
  assert.ok(
    integration.indexOf("loadProductMasterLifecycle") <
      integration.indexOf("loadInternalLedgerStatus"),
  );
});

test("lifecycle grades map to increase, markdown and discontinue review states", () => {
  assert.match(integration, /grade <= -4/);
  assert.match(integration, /return "discontinued_review"/);
  assert.match(integration, /grade === -3/);
  assert.match(integration, /return "decrease_review"/);
  assert.match(integration, /grade > 0/);
  assert.match(integration, /return "increase_required"/);
});

test("Product Master shadow mode never auto-selects a real price write", () => {
  assert.match(
    integration,
    /defaultSelected:\s*!Boolean\(row\.shadowMode\)\s*&&\s*decision === "increase_required"/,
  );
  assert.match(page, /실제 가격변경 차단/);
  assert.match(
    page,
    /row\.reorderingAllowed === false[\s\S]*?row\.shadowMode[\s\S]*?"향후 제한"[\s\S]*?"제한"/,
  );
  assert.match(page, /그림자 모드에서는 미래 가격·단종 상태만 표시/);
});

test("lifecycle overlay uses only protected GET reads and no external mutations", () => {
  assert.match(integration, /method: "GET"/);
  assert.doesNotMatch(integration, /method:\s*"POST"/);
  assert.doesNotMatch(integration, /method:\s*"PUT"/);
  assert.doesNotMatch(integration, /method:\s*"PATCH"/);
  assert.doesNotMatch(integration, /method:\s*"DELETE"/);
  assert.doesNotMatch(integration, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
});

test("internal page distinguishes grade, seasonality, protection and reorder state", () => {
  assert.match(page, /등급·시즌/);
  assert.match(page, /보호가격/);
  assert.match(page, /재발주/);
  assert.match(page, /row\.seasonality/);
  assert.match(page, /row\.protectionFloor/);
  assert.match(page, /row\.reorderingAllowed/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const loader = await readFile(
  new URL("../src/lib/commerceOperationsDashboard.ts", import.meta.url),
  "utf8",
);
const page = await readFile(
  new URL("../src/app/operations/page.tsx", import.meta.url),
  "utf8",
);
const registry = await readFile(
  new URL("../src/lib/extendedModuleRegistry.ts", import.meta.url),
  "utf8",
);
const salesCache = await readFile(
  new URL("../src/lib/priceAdjustmentSalesCache.ts", import.meta.url),
  "utf8",
);
const healthWriter = await readFile(
  new URL("../src/lib/commerceDataSourceHealth.ts", import.meta.url),
  "utf8",
);

test("operations dashboard combines automation, freshness and price job status", () => {
  assert.match(loader, /commerce_operation_runs/);
  assert.match(loader, /commerce_data_source_health/);
  assert.match(loader, /shopling_price_adjustment_bulk_jobs/);
  assert.match(loader, /awaitingApproval/);
  assert.match(loader, /staleSources/);
  assert.match(loader, /pendingPriceJobs/);
});

test("freshness is recalculated from generated time and allowed age", () => {
  assert.match(loader, /ageMinutes/);
  assert.match(loader, /source\.max_age_minutes/);
  assert.match(loader, /expired/);
  assert.match(loader, /effectiveStatus/);
});

test("complete sales cache snapshots update the 24 hour health record", () => {
  assert.match(salesCache, /recordCommerceDataSourceHealth/);
  assert.match(salesCache, /sourceKey: "sales_orders"/);
  assert.match(salesCache, /maxAgeMinutes: 24 \* 60/);
  assert.match(salesCache, /salesCacheFresh/);
  assert.match(healthWriter, /on_conflict=source_key/);
  assert.match(healthWriter, /resolution=merge-duplicates/);
});

test("dashboard shows operational status without actor email or input snapshots", () => {
  assert.match(page, /운영 안전센터/);
  assert.match(page, /최종 승인 대기/);
  assert.match(page, /데이터 최신도/);
  assert.match(page, /자동화 실행 기록/);
  assert.match(page, /샵플링 가격 Bulk 작업/);
  assert.doesNotMatch(page, /actor_id|ownerEmail|input_snapshot/);
});

test("operations safety center is visible in the module registry", () => {
  assert.match(registry, /commerceOperationsModule/);
  assert.match(registry, /route: "\/operations"/);
  assert.match(registry, /실패·승인 대기 추적/);
});

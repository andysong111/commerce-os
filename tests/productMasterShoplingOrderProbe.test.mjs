import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [service, api, page, backfillCron, salesApi, incrementalCron] =
  await Promise.all([
    readFile("src/lib/productMasterShoplingOrderProbe.ts", "utf8"),
    readFile(
      "src/app/api/product-master/shopling-sales-backfill/order-probe/route.ts",
      "utf8",
    ),
    readFile(
      "src/app/product-master/shopling-sales-backfill/order-probe/page.tsx",
      "utf8",
    ),
    readFile(
      "src/app/api/cron/product-master-shopling-sales-backfill/route.ts",
      "utf8",
    ),
    readFile(
      "src/app/api/product-master/shopling-sales-backfill/route.ts",
      "utf8",
    ),
    readFile(
      "src/app/api/cron/product-master-shopling-sales-incremental/route.ts",
      "utf8",
    ),
  ]);

test("order probe uses the exact production request builder, parser and TLS transport", () => {
  assert.match(service, /buildShoplingReadRequestXml/);
  assert.match(service, /parseShoplingReadResponse/);
  assert.match(service, /postShoplingXml/);
  assert.match(service, /"orders"/);
  assert.match(service, /config\.ordersUrl/);
  assert.match(service, /timeoutMs: 30_000/);
  assert.match(service, /commerce-os-ops-center-shopling-order-probe\/1\.0/);
});

test("automatic probe is bounded to seven recent days and a six-hour cooldown", () => {
  assert.match(service, /PROBE_WINDOW_DAYS = 7/);
  assert.match(service, /PROBE_COOLDOWN_MS = 6 \* 60 \* 60 \* 1_000/);
  assert.match(service, /inclusiveDays < 1 \|\| inclusiveDays > PROBE_WINDOW_DAYS/);
  assert.match(service, /ensureProductMasterShoplingOrderProbe/);
});

test("probe stores only structural evidence, never raw order bodies or business writes", () => {
  assert.match(service, /responseBytes/);
  assert.match(service, /parsedRowCount/);
  assert.match(service, /expectedContainerTagCount/);
  assert.match(service, /expectedRowTagCount/);
  assert.match(service, /tagSummary/);
  assert.match(service, /parsedFieldNames/);
  assert.match(service, /sourceWritesEnabled: false/);
  assert.match(service, /PRODUCT_MASTER_SHOPLING_ORDER_PROBE/);
  assert.match(service, /commerce_operation_runs/);
  assert.doesNotMatch(service, /result_snapshot:\s*\{[^}]*body/s);
  assert.doesNotMatch(service, /result_snapshot:\s*\{[^}]*rows/s);
  assert.doesNotMatch(
    service,
    /shopling-price|price-modify|inventory_movements|1688|receipt.*confirm/i,
  );
});

test("same-origin operator API exposes explicit read-only probe only", () => {
  assert.match(api, /isSameOriginOpsRequest/);
  assert.match(api, /export async function GET/);
  assert.match(api, /export async function POST/);
  assert.match(api, /runProductMasterShoplingOrderProbe/);
  assert.match(api, /String\(body\?\.action \?\? ""\) !== "probe"/);
  assert.doesNotMatch(api, /export async function (?:PUT|PATCH|DELETE)/);
});

test("evidence page states raw order values and business writes stay disabled", () => {
  assert.match(page, /원본 주문값·인증키는 저장하지 않고/);
  assert.match(page, /NO RAW ORDERS STORED · NO BUSINESS WRITES/);
  assert.match(page, /응답 XML 태그 구조/);
  assert.match(page, /파서가 확인한 필드명/);
  assert.match(page, /실제 쓰기.*차단/s);
});

test("backfill cron automatically diagnoses suspicious zero raw reads before another burst", () => {
  assert.match(backfillCron, /ZERO_ROW_PROBE_MIN_COMPLETED_RANGES = 3/);
  assert.match(backfillCron, /current\.completedRanges >= ZERO_ROW_PROBE_MIN_COMPLETED_RANGES/);
  assert.match(backfillCron, /current\.fetchedRows === 0/);
  assert.match(backfillCron, /ensureProductMasterShoplingOrderProbe/);
  assert.match(backfillCron, /if \(probe\.executed\)/);
  const probeReturnIndex = backfillCron.indexOf("diagnosticProbeExecuted: true");
  const burstIndex = backfillCron.indexOf("...(await runBoundedBurst())");
  assert.ok(probeReturnIndex >= 0 && burstIndex > probeReturnIndex);
});

test("zero-source backfill cannot write canary/full or unlock incremental sync", () => {
  assert.match(salesApi, /PRODUCT_MASTER_SHOPLING_SALES_ZERO_SOURCE_ROWS/);
  assert.match(salesApi, /zeroSourceBlocked/);
  assert.match(salesApi, /status: 409/);
  assert.match(incrementalCron, /PRODUCT_MASTER_SHOPLING_SALES_ZERO_SOURCE_BASELINE/);
  assert.match(incrementalCron, /baseline\.fetchedRows === 0/);
  assert.match(incrementalCron, /state: "WAITING_BASELINE"/);
});

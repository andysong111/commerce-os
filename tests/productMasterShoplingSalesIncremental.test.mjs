import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  "src/lib/productMasterShoplingSalesIncremental.ts",
  "utf8",
);
const engine = await readFile(
  "src/lib/productMasterShoplingSalesIncrementalEngine.ts",
  "utf8",
);
const cron = await readFile(
  "src/app/api/cron/product-master-shopling-sales-incremental/route.ts",
  "utf8",
);
const recoveryApi = await readFile(
  "src/app/api/product-master/shopling-sales-incremental/route.ts",
  "utf8",
);
const vercel = JSON.parse(await readFile("vercel.json", "utf8"));

test("incremental sync cannot start before the initial 24-month ledger is completed", () => {
  assert.match(workflow, /loadProductMasterShoplingSalesStatus/);
  assert.match(workflow, /baseline\.state !== "COMPLETED"/);
  assert.match(workflow, /PRODUCT_MASTER_SALES_INCREMENTAL_BASELINE_REQUIRED/);
});

test("incremental sync reads Shopling orders only and writes only Product Master salesMonthly", () => {
  assert.match(workflow, /new ShoplingReadClient\(config\)\.read\("orders", nextRange\)/);
  assert.match(workflow, /\/api\/integrations\/barcode-ledgers/);
  assert.match(workflow, /salesMonthly:/);
  assert.doesNotMatch(workflow, /ShoplingReadClient\(config\)\.read\("products"/);
  assert.doesNotMatch(workflow, /price-modify|1688|receipt\.confirmed/);
});

test("incremental sync preserves mapping stability and blocks unmapped or conflicting rows", () => {
  assert.match(workflow, /mappingFingerprint/);
  assert.match(workflow, /combined\.unmappedRows > 0/);
  assert.match(workflow, /buildShoplingIncrementalReconcilePlan/);
  assert.match(workflow, /plan\.blockers\.length/);
  assert.match(engine, /UNEXPECTED_ROLLING_DROP/);
  assert.match(engine, /LEGACY_MONTH_OVERLAP/);
});

test("incremental reconciliation keeps inactive B-code SKUs addressable for historical sales", () => {
  assert.match(engine, /MANAGED_BARCODE = \/\^B\[A-Z\]\{2\}/);
  assert.match(engine, /Inactive B-prefixed SKUs still own real historical sales/);
  assert.doesNotMatch(engine, /if \(row\.skuActive === false\) continue/);
  assert.match(workflow, /MANAGED_BARCODE = \/\^B\[A-Z\]\{2\}/);
  assert.match(workflow, /skuActive: product\.skuActive !== false/);
  assert.match(workflow, /active: listing\.active !== false/);
  assert.doesNotMatch(workflow, /\.filter\(\(product\) => product\.skuActive !== false\)/);
});

test("incremental writes are bounded, idempotent and fully reverified", () => {
  assert.match(workflow, /APPLY_BATCH_SIZE = 500/);
  assert.match(workflow, /pending\.slice\(0, APPLY_BATCH_SIZE\)/);
  assert.match(workflow, /retryIsIdempotent: true/);
  assert.match(workflow, /sales-ledger-snapshot/);
  assert.match(workflow, /exactShoplingIncrementalSales/);
  assert.match(workflow, /failureKind: "VERIFY"/);
});

test("successful syncs are throttled to six hours and failures to one hour", () => {
  assert.match(workflow, /6 \* 60 \* 60 \* 1000/);
  assert.match(workflow, /60 \* 60 \* 1000/);
  assert.match(workflow, /6시간이 지나지 않아/);
  assert.match(workflow, /1시간 보호대기/);
});

test("range failures reduce from seven days to two without an infinite retry loop", () => {
  assert.match(workflow, /INCREMENTAL_DEFAULT_CHUNK_DAYS = 7/);
  assert.match(workflow, /INCREMENTAL_MINIMUM_CHUNK_DAYS = 2/);
  assert.match(workflow, /MAX_STEP_ATTEMPTS = 3/);
  assert.match(workflow, /RANGE_RETRY_EXHAUSTED/);
  assert.match(workflow, /2일 단위로 안전 재접수/);
});

test("cron is secret-protected, bounded, and recovery-staggered hourly", () => {
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /MAX_STEPS_PER_INVOCATION = 6/);
  assert.match(cron, /EXTRA_STEP_START_BUDGET_MS = 10_000/);
  assert.match(cron, /ensureProductMasterShoplingSalesIncrementalRequest/);
  assert.match(cron, /runProductMasterShoplingSalesIncrementalStep/);
  assert.deepEqual(
    vercel.crons.find(
      (entry) => entry.path === "/api/cron/product-master-shopling-sales-incremental",
    ),
    {
      path: "/api/cron/product-master-shopling-sales-incremental",
      schedule: "17 * * * *",
    },
  );
});

test("same-origin recovery API can advance only an already-created incremental request", () => {
  assert.match(recoveryApi, /isSameOriginOpsRequest/);
  assert.match(recoveryApi, /runProductMasterShoplingSalesIncrementalStep/);
  assert.match(recoveryApi, /action !== "run-next"/);
  assert.doesNotMatch(
    recoveryApi,
    /createProductMasterShoplingSalesIncrementalRequest|ensureProductMasterShoplingSalesIncrementalRequest/,
  );
});
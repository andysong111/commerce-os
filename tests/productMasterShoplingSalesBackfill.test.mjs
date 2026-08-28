import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  "src/lib/productMasterShoplingSalesBackfill.ts",
  "utf8",
);
const api = await readFile(
  "src/app/api/product-master/shopling-sales-backfill/route.ts",
  "utf8",
);
const cron = await readFile(
  "src/app/api/cron/product-master-shopling-sales-backfill/route.ts",
  "utf8",
);
const scheduler = await readFile(
  "supabase/migrations/202608280009_ops_adaptive_dispatcher.sql",
  "utf8",
);

test("sales backfill keeps Shopling read-only and writes only Product Master salesMonthly", () => {
  assert.match(workflow, /new ShoplingReadClient\(config\)\.read\("orders", nextRange\)/);
  assert.match(workflow, /\/api\/integrations\/barcode-ledgers/);
  assert.match(workflow, /salesMonthly:/);
  assert.doesNotMatch(workflow, /shopling-price|price-modify|1688|receipt\.confirmed/);
});

test("sales backfill requires mapping stability, unmapped zero, one-row canary and post-write verification", () => {
  assert.match(workflow, /mappingFingerprint/);
  assert.match(workflow, /report\.unmappedRows > 0/);
  assert.match(workflow, /mode === "CANARY" \? plan\.pending\.slice\(0, 1\)/);
  assert.match(workflow, /PRODUCT_MASTER_SALES_CANARY_REQUIRED/);
  assert.match(workflow, /PRODUCT_MASTER_SALES_VERIFY_FAILED/);
  assert.match(workflow, /LEGACY_MONTH_OVERLAP/);
});

test("inactive B-code SKU identity is pinned and remains eligible for historical ledger apply", () => {
  assert.match(workflow, /MANAGED_BARCODE = \/\^B\[A-Z\]\{2\}/);
  assert.match(workflow, /skuActive: product\.skuActive !== false/);
  assert.match(workflow, /active: listing\.active !== false/);
  assert.match(workflow, /uniqueSkuByManagedBarcode/);
  assert.match(workflow, /Historical B-code sales remain attached to their stable SKU/);
  assert.doesNotMatch(workflow, /\.filter\(\(product\) => product\.skuActive !== false\)\s*\.map\(\(product\) => \[text\(product\.barcode\)/);
});

test("sales writes are deterministic, idempotent and bounded", () => {
  assert.match(workflow, /shopling_orders_24m_v1/);
  assert.match(workflow, /APPLY_BATCH_SIZE = 500/);
  assert.match(workflow, /retryIsIdempotent: true/);
  assert.match(workflow, /sales-ledger-snapshot/);
});

test("browser write API is same-origin only", () => {
  assert.match(api, /isSameOriginOpsRequest/);
  assert.match(api, /action === "canary" \|\| action === "full"/);
  assert.match(api, /applyProductMasterShoplingSales/);
});

test("adaptive-range worker is a low-frequency diagnostic dispatcher task", () => {
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /PRODUCT_MASTER_SHOPLING_SALES_DEFAULT_CHUNK_DAYS/);
  assert.match(cron, /PRODUCT_MASTER_SHOPLING_SALES_FALLBACK_CHUNK_DAYS/);
  assert.match(cron, /PRODUCT_MASTER_SHOPLING_SALES_MINIMUM_CHUNK_DAYS/);
  assert.match(cron, /current\.state === "IDLE"/);
  assert.match(
    scheduler,
    /'product-master-shopling-sales-backfill', '\/api\/cron\/product-master-shopling-sales-backfill', 'diagnostic', 230, true, 21600, 1800, 43200/,
  );
});

test("successful Shopling chunks may burst only inside a strict serverless time budget", () => {
  assert.match(cron, /MAX_STEPS_PER_INVOCATION = 6/);
  assert.match(cron, /EXTRA_STEP_START_BUDGET_MS = 10_000/);
  assert.match(cron, /result\.processed === true/);
  assert.match(cron, /result\.state === "RUNNING"/);
  assert.match(cron, /Date\.now\(\) - startedAt < EXTRA_STEP_START_BUDGET_MS/);
  assert.match(cron, /burstElapsedMs/);
});

test("verified full baseline remains completed after rolling incremental values change", () => {
  assert.match(workflow, /readOperations\(PRODUCT_MASTER_SHOPLING_SALES_FULL, cid, 5\)/);
  assert.match(workflow, /function fullApplyVerified/);
  assert.match(workflow, /result\.verified === true/);
  assert.match(workflow, /result\.pendingCount/);
  assert.match(workflow, /result\.blockerCount/);
  assert.match(workflow, /if \(fullApplyVerified\(context\)\)/);
  assert.match(workflow, /이후 증분 동기화가 같은 원장 ID를 최신값으로 갱신해도 기준선 완료 상태는 유지됩니다/);
});

test("zero-pending full apply still records the immutable completion milestone", () => {
  assert.match(workflow, /mode === \"FULL\" && canaryVerified\(context\)/);
  assert.match(workflow, /selectedCount: 0/);
  assert.match(workflow, /operationType: PRODUCT_MASTER_SHOPLING_SALES_FULL/);
});

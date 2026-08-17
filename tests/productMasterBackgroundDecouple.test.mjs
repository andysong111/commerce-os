import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const controlPlane = await readFile(
  new URL("../public/product-launch-tracker-app/product-master-control-plane.js", import.meta.url),
  "utf8",
);
const productMasterPage = await readFile(
  new URL("../src/app/product-launch-tracker/page.tsx", import.meta.url),
  "utf8",
);
const reviewPage = await readFile(
  new URL("../src/app/detail-page-ai-review/page.tsx", import.meta.url),
  "utf8",
);
const coalescer = await readFile(
  new URL(
    "../src/components/detail-page-ai-review/DetailPageJobListRequestCoalescer.tsx",
    import.meta.url,
  ),
  "utf8",
);
const migration = await readFile(
  new URL(
    "../supabase/migrations/20260817155300_detail_page_job_hot_read_indexes.sql",
    import.meta.url,
  ),
  "utf8",
);

test("workflow recovery refreshes data without reloading the whole product master page", () => {
  assert.doesNotMatch(controlPlane, /window\.location\.reload\(\)/);
  assert.match(controlPlane, /window\.dispatchEvent\(new Event\("focus"\)\)/);
  assert.match(controlPlane, /if \(!event\.isTrusted\) return/);
});

test("background refresh does not force a progress cursor over the product master table", () => {
  assert.match(controlPlane, /cursor:\s*default\s*!important/);
});

test("product master page no longer mounts whole-catalog browser automation pollers", () => {
  assert.doesNotMatch(productMasterPage, /ProductLaunchTrackerCanonicalPriceBridge/);
  assert.doesNotMatch(productMasterPage, /ProductLaunchDetailPageStatusGuard/);
  assert.match(productMasterPage, /백그라운드 자동화 · 상품마스터와 분리 운영/);
});

test("detail page review coalesces duplicate job list GET requests", () => {
  assert.match(reviewPage, /DetailPageJobListRequestCoalescer/);
  assert.match(coalescer, /SHARED_RESULT_TTL_MS = 10_000/);
  assert.match(coalescer, /if \(inFlight\)/);
  assert.match(coalescer, /cachedResponse\.clone\(\)/);
  assert.match(coalescer, /method !== "GET" && response\.ok/);
});

test("detail page job hot reads have partial indexes", () => {
  assert.match(migration, /product_launch_upload_jobs_owner_detail_page_updated_idx/);
  assert.match(migration, /payload->>'kind' = 'detail_page'/);
  assert.match(migration, /product_launch_upload_jobs_active_detail_page_updated_idx/);
  assert.match(migration, /status in \('queued','running'\)/);
});

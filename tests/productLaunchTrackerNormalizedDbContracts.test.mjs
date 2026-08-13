import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const paths = {
  schema: new URL(
    "../supabase/migrations/202608130001_product_launch_normalized.sql",
    import.meta.url,
  ),
  store: new URL(
    "../src/lib/productLaunchTrackerNormalizedStore.ts",
    import.meta.url,
  ),
  gateway: new URL(
    "../src/app/api/product-launch-tracker/normalized-read/route.ts",
    import.meta.url,
  ),
  legacy: new URL(
    "../src/app/api/product-launch-tracker/optimized-legacy/route.ts",
    import.meta.url,
  ),
  cutover: new URL(
    "../src/app/api/product-launch-tracker/migrations/normalized-db-20260813/route.ts",
    import.meta.url,
  ),
  config: new URL("../next.config.ts", import.meta.url),
  workflow: new URL(
    "../.github/workflows/product-launch-normalized-db-20260813.yml",
    import.meta.url,
  ),
};

const [schema, store, gateway, legacy, cutover, config, workflow] =
  await Promise.all(Object.values(paths).map((path) => readFile(path, "utf8")));

test("schema separates workspaces, products and options while retaining legacy JSON", () => {
  assert.match(schema, /create table if not exists public\.product_launch_workspaces/);
  assert.match(schema, /create table if not exists public\.product_launch_items/);
  assert.match(schema, /create table if not exists public\.product_launch_options/);
  assert.match(schema, /from public\.product_launch_tracker_states/);
  assert.doesNotMatch(schema, /drop table.*product_launch_tracker_states/i);
});

test("normalized store supports page, item and incremental synchronization", () => {
  assert.match(store, /queryProductLaunchNormalizedPage/);
  assert.match(store, /readProductLaunchNormalizedItem/);
  assert.match(store, /readProductLaunchNormalizedItems/);
  assert.match(store, /syncProductLaunchNormalizedChangedItems/);
  assert.match(store, /syncProductLaunchNormalizedFull/);
  assert.match(store, /normalized_read_enabled/);
});

test("gateway reads normalized rows only when fresh and keeps legacy fallback", () => {
  assert.match(gateway, /isProductLaunchNormalizedFresh/);
  assert.match(gateway, /listSource: "normalized"/);
  assert.match(gateway, /itemSource: "normalized"/);
  assert.match(gateway, /syncProductLaunchNormalizedChangedItems/);
  assert.match(gateway, /return proxyLegacy\(request\)/);
  assert.match(legacy, /export \{ GET, PATCH \}/);
  assert.match(config, /destination: "\/api\/product-launch-tracker\/normalized-read"/);
});

test("cutover validates every stored payload before enabling normalized reads", () => {
  assert.match(cutover, /verifyParity/);
  assert.match(cutover, /stableJson/);
  assert.match(cutover, /PRODUCT_LAUNCH_NORMALIZED_PARITY_FAILED/);
  assert.match(cutover, /setProductLaunchNormalizedReadEnabled/);
  assert.match(cutover, /syncProductLaunchNormalizedFull/);
});

test("production workflow requires normalized page and item sources", () => {
  assert.match(workflow, /Backfill, validate every payload, and enable normalized reads/);
  assert.match(workflow, /body\.listSource !== 'normalized'/);
  assert.match(workflow, /body\.itemSource !== 'normalized'/);
  assert.match(workflow, /parity\?\.ok !== true/);
});

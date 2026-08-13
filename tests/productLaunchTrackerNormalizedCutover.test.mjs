import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  config: new URL("../next.config.ts", import.meta.url),
  normalized: new URL(
    "../src/app/api/product-launch-tracker/normalized-optimized/route.ts",
    import.meta.url,
  ),
  state: new URL(
    "../src/app/api/product-launch-tracker/normalized-state/route.ts",
    import.meta.url,
  ),
  cutover: new URL(
    "../src/lib/productLaunchTrackerNormalizedCutover.ts",
    import.meta.url,
  ),
  store: new URL(
    "../src/lib/productLaunchTrackerNormalizedStore.ts",
    import.meta.url,
  ),
  migration: new URL(
    "../supabase/migrations/202608130001_product_launch_normalized.sql",
    import.meta.url,
  ),
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, url]) => [key, await readFile(url, "utf8")]),
  ),
);

test("public tracker routes are wrapped without deleting the legacy source", () => {
  assert.match(source.config, /normalized-optimized/);
  assert.match(source.config, /normalized-state/);
  assert.match(source.normalized, /legacyGet/);
  assert.match(source.normalized, /legacyPatch/);
  assert.match(source.state, /legacyPut/);
});

test("normalized reads require an enabled and fresh workspace", () => {
  assert.match(source.normalized, /loadFreshProductLaunchNormalized/);
  assert.match(source.store, /normalized_read_enabled !== true/);
  assert.match(source.store, /source_state_updated_at/);
  assert.match(source.normalized, /listSource: "normalized"/);
});

test("page and detail reads use normalized product and option rows", () => {
  assert.match(source.normalized, /queryProductLaunchNormalizedPage/);
  assert.match(source.normalized, /readProductLaunchNormalizedItem/);
  assert.match(source.normalized, /readProductLaunchNormalizedItems/);
  assert.match(source.normalized, /itemSource: "normalized"/);
  assert.match(source.store, /product_launch_items/);
  assert.match(source.store, /product_launch_options/);
  assert.match(source.normalized, /return legacyGet\(request\)/);
});

test("legacy writes remain authoritative and refresh normalized rows", () => {
  assert.match(source.normalized, /syncProductLaunchNormalizedAfterMutation/);
  assert.match(source.state, /syncProductLaunchNormalizedFull/);
  assert.match(source.normalized, /disableProductLaunchNormalizedRead/);
});

test("cutover requires item and option count parity before enabling reads", () => {
  assert.match(source.cutover, /PRODUCT_LAUNCH_NORMALIZED_COUNT_MISMATCH/);
  assert.match(source.cutover, /setProductLaunchNormalizedReadEnabled/);
  assert.match(source.cutover, /countMatch && fresh/);
  assert.match(source.migration, /normalized_read_enabled boolean not null default false/);
});

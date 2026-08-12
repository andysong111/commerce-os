import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const paths = {
  snapshot: new URL(
    "../src/lib/productLaunchTrackerListSnapshot.ts",
    import.meta.url,
  ),
  server: new URL("../src/lib/productLaunchTrackerServer.ts", import.meta.url),
  optimized: new URL(
    "../src/app/api/product-launch-tracker/optimized/route.ts",
    import.meta.url,
  ),
  state: new URL(
    "../src/app/api/product-launch-tracker/state/route.ts",
    import.meta.url,
  ),
  migration: new URL(
    "../src/app/api/product-launch-tracker/migrations/list-snapshot-20260813/route.ts",
    import.meta.url,
  ),
  workflow: new URL(
    "../.github/workflows/product-launch-list-snapshot-20260813.yml",
    import.meta.url,
  ),
};

const [snapshot, server, optimized, state, migration, workflow] =
  await Promise.all(Object.values(paths).map((path) => readFile(path, "utf8")));

test("list snapshot keeps the existing page summary shape without full item payloads", () => {
  assert.match(snapshot, /summaries: index\.summaries/);
  assert.match(snapshot, /queryProductLaunchListPage/);
  assert.match(snapshot, /items: rows\.slice\(offset, offset \+ pageSize\)\.map\(stripSearchText\)/);
  assert.doesNotMatch(snapshot, /state_payload/);
});

test("Supabase reads only the nested list snapshot for page loading", () => {
  assert.match(
    server,
    /list_snapshot:state_payload->\$\{PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD\}/,
  );
  assert.match(server, /readProductLaunchListSnapshot/);
  assert.match(server, /withProductLaunchListSnapshot/);
});

test("page mode uses the lightweight cache while detail and export stay authoritative", () => {
  const pageBranch = optimized.indexOf('if (mode === "page")');
  const fullLoad = optimized.indexOf("const loaded = await loadCachedIndex", pageBranch);
  assert.ok(pageBranch >= 0);
  assert.ok(fullLoad > pageBranch);
  assert.match(optimized, /loadCachedListIndex/);
  assert.match(optimized, /queryProductLaunchListPage/);
  assert.match(optimized, /listSource: loaded\.source/);
  assert.match(optimized, /if \(mode === "items"\)/);
  assert.match(optimized, /if \(mode === "item"\)/);
  assert.match(optimized, /if \(mode === "export"\)/);
  assert.match(optimized, /getProductLaunchTrackerItem\(loaded\.index/);
});

test("every canonical state write regenerates the lightweight snapshot", () => {
  assert.match(state, /prepareStateForStorage/);
  assert.match(state, /withProductLaunchListSnapshot/);
  assert.match(state, /delete cloned\[PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD\]/);
  assert.match(state, /delete merged\[PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD\]/);
  assert.match(optimized, /const persistedState = withProductLaunchListSnapshot\(mutation\.state\)/);
});

test("transient Supabase schema-cache failures are retried with bounded reads", () => {
  assert.match(server, /const PRODUCT_LAUNCH_READ_ATTEMPTS = 6/);
  assert.match(server, /const PRODUCT_LAUNCH_READ_TIMEOUT_MS = 12_000/);
  assert.match(server, /PRODUCT_LAUNCH_READ_RETRY_DELAYS_MS = \[750, 1_500, 3_000, 5_000, 8_000\]/);
  assert.match(server, /"pgrst002"/);
  assert.match(server, /"schema cache"/);
  assert.match(server, /"could not query the database"/);
  assert.match(server, /readProductLaunchStorageJson/);
  assert.match(server, /AbortController/);
  assert.match(server, /TRANSIENT_STORAGE_STATUSES/);
});

test("one-time migration verifies the JSON-path snapshot and production page source", () => {
  assert.match(migration, /productLaunchListSnapshot20260813/);
  assert.match(migration, /verifyStoredSnapshot/);
  assert.match(migration, /snapshotReadable: true/);
  assert.match(workflow, /Apply snapshot exactly once/);
  assert.match(workflow, /Verify idempotency and JSON-path read/);
  assert.match(workflow, /Probe production page through lightweight list path/);
  assert.match(workflow, /body\.listSource !== 'snapshot'/);
  assert.match(workflow, /--connect-timeout 10 --max-time 50/);
  assert.match(workflow, /for attempt in \$\(seq 1 20\)/);
});

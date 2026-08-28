import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [migration, route] = await Promise.all([
  read("supabase/migrations/202608280010_product_launch_list_snapshot_read_model.sql"),
  read("src/app/api/product-launch-tracker/recovery-page/route.ts"),
]);

test("product launch list is stored as a separate one-row-per-owner read model", () => {
  assert.match(migration, /create table if not exists public\.product_launch_list_snapshots/);
  assert.match(migration, /owner_id uuid primary key/);
  assert.match(migration, /snapshot_payload jsonb not null/);
  assert.match(migration, /sync_product_launch_list_snapshot_read_model/);
  assert.match(migration, /after insert or update of state_payload/);
  assert.match(migration, /on conflict \(owner_id\) do update/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /to service_role/);
});

test("recovery reads the compact table first and retains a bounded legacy fallback", () => {
  assert.match(route, /SNAPSHOT_TABLE = "product_launch_list_snapshots"/);
  assert.match(route, /LEGACY_TABLE = "product_launch_tracker_states"/);
  assert.match(route, /snapshot-read-model/);
  assert.match(route, /legacy-snapshot-fallback/);
  assert.match(route, /attempts: 1/);
  assert.match(route, /timeoutMs: RECOVERY_READ_TIMEOUT_MS/);
  assert.doesNotMatch(route, /queryProductLaunchNormalizedPage/);
});

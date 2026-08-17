import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260817093500_product_launch_normalized_freshness_guard.sql",
    import.meta.url,
  ),
  "utf8",
);

test("legacy state changes invalidate normalized workflow reads", () => {
  assert.match(migration, /product_launch_mark_normalized_stale/);
  assert.match(migration, /after update of state_payload on public\.product_launch_tracker_states/i);
  assert.match(migration, /normalized_read_enabled = false/);
  assert.match(migration, /old\.state_payload is distinct from new\.state_payload/i);
});

test("a completed mirror sync is promoted only when its source timestamp matches legacy", () => {
  assert.match(migration, /product_launch_promote_fresh_normalized/);
  assert.match(migration, /before update of source_state_updated_at on public\.product_launch_workspaces/i);
  assert.match(migration, /new\.source_state_updated_at = v_source_updated_at/i);
  assert.match(migration, /new\.normalized_read_enabled := true/);
});

test("default and unfinished hot-list orderings have composite indexes", () => {
  assert.match(migration, /product_launch_items_owner_updated_model_idx/);
  assert.match(migration, /product_launch_items_owner_unfinished_updated_model_idx/);
});

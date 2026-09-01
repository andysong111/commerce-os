import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageRoute = new URL("../src/app/api/shopling-market-group-canary/v0325/download/route.ts", import.meta.url);
const migration = new URL("../supabase/migrations/202609020001_shopling_market_single_active_wave.sql", import.meta.url);

test("v0.3.25 finalizes a channel as soon as any Shopling result succeeds", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /const VERSION = "0\.3\.25"/);
  assert.match(source, /const settledFrames = frames\.filter/);
  assert.match(source, /const hasSuccess = settledFrames\.some/);
  assert.match(source, /const allSettled = frames\.length > 0/);
  assert.match(source, /else if \(allSettled && anyFailure\)/);
  assert.match(source, /success: resultLike && !processing && hasSuccess/);
  assert.match(source, /const hasSuccess = direct\.success \|\| frameHasSuccess/);
  assert.match(source, /!directDefinitive && !frameHasSuccess/);
});

test("v0.3.25 retries instead of advancing when another wave already owns the product", async () => {
  const source = await readFile(packageRoute, "utf8");
  assert.match(source, /SHOPLING_ACTIVE_WAVE_EXISTS/);
  assert.match(source, /selectedCoordinatorTick\(\), 450/);
  assert.match(source, /return;/);
});

test("database trigger serializes distinct run ids per launch item while allowing same-run 3-channel wave", async () => {
  const source = await readFile(migration, "utf8");
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /launch_item_id/);
  assert.match(source, /claim_run_id <> new\.claim_run_id/);
  assert.match(source, /SHOPLING_ACTIVE_WAVE_EXISTS/);
  assert.match(source, /before update of status, claim_run_id/);
});

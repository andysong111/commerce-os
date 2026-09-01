import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reconcilePath = new URL("../src/lib/productLifecycleLiveReconcile.ts", import.meta.url);
const routePath = new URL("../src/app/api/cron/product-lifecycle-refresh/route.ts", import.meta.url);
const migrationPath = new URL(
  "../supabase/migrations/20260901121000_product_lifecycle_runtime_gates_v1.sql",
  import.meta.url,
);

test("runtime reconcile is fail-closed and limits Shopling live mutation to reversible B/C states", async () => {
  const source = await readFile(reconcilePath, "utf8");
  assert.match(source, /product_lifecycle_runtime_config/);
  assert.match(source, /shopling_non_destructive_live/);
  assert.match(source, /purchase_stop_live/);
  assert.match(source, /delete_live/);
  assert.match(source, /desired === "SELLING"/);
  assert.match(source, /desired === "SOLD_OUT"/);
  assert.match(source, /!\["B", "C"\]\.includes\(current\)/);
  assert.match(source, /deleteExecutionAllowed: false/);
  assert.match(source, /deleteQueuedCount: 0/);
  assert.doesNotMatch(source, /desired_state:\s*"DELETE"/);
});

test("runtime reconcile keeps active work serialized and uses read-before-write reconciliation", async () => {
  const source = await readFile(reconcilePath, "utf8");
  assert.match(source, /loadShoplingLifecycleStatusSnapshot/);
  assert.match(source, /\.in\("status", \["pending", "claimed"\]\)/);
  assert.match(source, /activeQueueSkippedCount/);
  assert.match(source, /observed\.state !== "READY"/);
  assert.match(source, /status: "pending"/);
  assert.match(source, /shadow_mode: false/);
  assert.match(source, /LIVE_RECONCILIATION/);
});

test("purchase live gate changes lifecycle shadow rows only through explicit runtime config", async () => {
  const source = await readFile(reconcilePath, "utf8");
  assert.match(source, /syncPurchaseShadowMode/);
  assert.match(source, /shadow_mode: !purchaseStopLive/);
  assert.match(source, /\.eq\("shadow_mode", purchaseStopLive\)/);
});

test("lifecycle cron refresh always runs runtime reconcile after policy refresh", async () => {
  const source = await readFile(routePath, "utf8");
  const refreshIndex = source.indexOf("runProductLifecycleRefresh()");
  const reconcileIndex = source.indexOf("runProductLifecycleLiveReconcile(summary.generatedAt)");
  assert.ok(refreshIndex >= 0 && reconcileIndex > refreshIndex);
  assert.match(source, /DELETE는 계속 잠금/);
});

test("runtime gate migration defaults every live control to false and remains server-only", async () => {
  const source = await readFile(migrationPath, "utf8");
  assert.match(source, /shopling_non_destructive_live boolean not null default false/);
  assert.match(source, /purchase_stop_live boolean not null default false/);
  assert.match(source, /delete_live boolean not null default false/);
  assert.match(source, /enable row level security/);
  assert.match(source, /revoke all on table public\.product_lifecycle_runtime_config from anon, authenticated/);
});

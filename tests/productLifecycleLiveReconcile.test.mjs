import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reconcilePath = new URL("../src/lib/productLifecycleLiveReconcile.ts", import.meta.url);
const runtimeConfigPath = new URL("../src/lib/productLifecycleRuntimeConfig.ts", import.meta.url);
const purchaseOverlayPath = new URL("../src/lib/productLifecyclePurchaseOverlay.ts", import.meta.url);
const routePath = new URL("../src/app/api/cron/product-lifecycle-refresh/route.ts", import.meta.url);
const migrationPath = new URL(
  "../supabase/migrations/20260901121000_product_lifecycle_runtime_gates_v1.sql",
  import.meta.url,
);

test("runtime reconcile is fail-closed and limits Shopling live mutation to reversible B/C states", async () => {
  const source = await readFile(reconcilePath, "utf8");
  assert.match(source, /loadProductLifecycleRuntimeConfig/);
  assert.match(source, /desired === "SELLING"/);
  assert.match(source, /desired === "SOLD_OUT"/);
  assert.match(source, /!\["B", "C"\]\.includes\(current\)/);
  assert.match(source, /deleteExecutionAllowed: false/);
  assert.match(source, /deleteQueuedCount: 0/);
  assert.doesNotMatch(source, /desired_state:\s*"DELETE"/);
});

test("runtime reconcile remains observable with writes off and queues only behind explicit Shopling gate", async () => {
  const source = await readFile(reconcilePath, "utf8");
  assert.match(source, /loadShoplingLifecycleStatusSnapshot/);
  assert.match(source, /wouldQueueMismatchCount: mismatchRows\.length/);
  assert.match(source, /queuedMismatchCount/);
  assert.match(source, /if \(config\.shoplingNonDestructiveLive && mismatchRows\.length\)/);
  assert.doesNotMatch(source, /if \(!config\.shoplingNonDestructiveLive\)[\s\S]{0,200}return emptySummary/);
});

test("runtime reconcile blocks any unresolved live action for the same goods key before retry", async () => {
  const source = await readFile(reconcilePath, "utf8");
  assert.match(source, /\["pending", "claimed", "failed", "confirm_needed"\]/);
  assert.match(source, /blockingGoodsKeys/);
  assert.match(source, /blockingGoodsKeys\.has\(goodsKey\)/);
  assert.match(source, /blockedQueueSkippedCount/);
  assert.match(source, /observed\.state !== "READY"/);
  assert.match(source, /status: "pending"/);
  assert.match(source, /shadow_mode: false/);
  assert.match(source, /LIVE_RECONCILIATION/);
});

test("purchase STOP live gate is independent from lifecycle state shadow_mode", async () => {
  const config = await readFile(runtimeConfigPath, "utf8");
  const overlay = await readFile(purchaseOverlayPath, "utf8");
  assert.match(config, /shoplingNonDestructiveLive/);
  assert.match(config, /purchaseStopLive/);
  assert.match(config, /deleteLive/);
  assert.match(overlay, /loadProductLifecycleRuntimeConfig/);
  assert.match(overlay, /const purchaseStopLive = runtimeConfig\.purchaseStopLive/);
  assert.match(overlay, /recommendedQty: shouldStop && purchaseStopLive \? 0/);
  assert.doesNotMatch(overlay, /\.select\([^\n]*shadow_mode/);
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

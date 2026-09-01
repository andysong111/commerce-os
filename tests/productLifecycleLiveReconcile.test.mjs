import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reconcilePath = new URL("../src/lib/productLifecycleLiveReconcile.ts", import.meta.url);
const runtimeConfigPath = new URL("../src/lib/productLifecycleRuntimeConfig.ts", import.meta.url);
const purchaseOverlayPath = new URL("../src/lib/productLifecyclePurchaseOverlay.ts", import.meta.url);
const routePath = new URL("../src/app/api/cron/product-lifecycle-refresh/route.ts", import.meta.url);
const migrationPath = new URL("../supabase/migrations/20260901121000_product_lifecycle_runtime_gates_v1.sql", import.meta.url);

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

test("runtime reconcile deduplicates by goods key and blocks conflicting or non-reversible references", async () => {
  const source = await readFile(reconcilePath, "utf8");
  assert.match(source, /const referencesByGoodsKey = new Map<string, LifecycleListingReference\[]>\(\)/);
  assert.match(source, /for \(const goodsKey of allGoodsKeys\)/);
  assert.match(source, /references\.length > 1\) duplicateReferenceGoodsKeyCount \+= 1/);
  assert.match(source, /references\.some\(\(reference\) => reference\.requiresReview\)/);
  assert.match(source, /desiredStates\.length !== 1 \|\| reversibleDesiredStates\.length !== 1/);
  assert.match(source, /TARGET_CONFLICT_OR_NON_REVERSIBLE/);
  assert.match(source, /targetConflictCount \+= 1/);
  assert.match(source, /\["live-reconcile", goodsKey, current, desiredState, currentHourKey\(generatedAt\)\]/);
  assert.doesNotMatch(source, /\["live-reconcile", text\(state\.sku_id\), goodsKey/);
});

test("runtime reconcile audits unique-listing identity and concrete mismatch samples before live activation", async () => {
  const source = await readFile(reconcilePath, "utf8");
  assert.match(source, /listingReferenceCount/);
  assert.match(source, /listingCount: allGoodsKeys\.length/);
  assert.match(source, /duplicateReferenceGoodsKeyCount/);
  assert.match(source, /mismatchSample/);
  assert.match(source, /unresolvedSample/);
  assert.match(source, /referenceSkuIds/);
  assert.match(source, /referenceCount: references\.length/);
  assert.match(source, /AUDIT_SAMPLE_LIMIT = 50/);
});

test("runtime reconcile remains observable with writes off and queues only behind explicit Shopling gate", async () => {
  const source = await readFile(reconcilePath, "utf8");
  assert.match(source, /loadShoplingLifecycleStatusSnapshot/);
  assert.match(source, /wouldQueueMismatchCount: mismatchRows\.length/);
  assert.match(source, /queuedMismatchCount/);
  assert.match(source, /if \(config\.shoplingNonDestructiveLive && liveRows\.length\)/);
  assert.match(source, /deferredMismatchCount/);
  assert.doesNotMatch(source, /if \(!config\.shoplingNonDestructiveLive\)[\s\S]{0,200}return emptySummary/);
});

test("runtime reconcile caps each live Shopling batch and blocks unresolved goods keys from automatic retry", async () => {
  const source = await readFile(reconcilePath, "utf8");
  const config = await readFile(runtimeConfigPath, "utf8");
  assert.match(source, /\["pending", "claimed", "failed", "confirm_needed"\]/);
  assert.match(source, /blockingGoodsKeys\.has\(goodsKey\)/);
  assert.match(source, /const liveRows = mismatchRows\.slice\(0, config\.shoplingLiveBatchLimit\)/);
  assert.match(source, /blockedQueueSkippedCount/);
  assert.match(source, /observed\.state !== "READY"/);
  assert.match(source, /status: "pending"/);
  assert.match(source, /shadow_mode: false/);
  assert.match(source, /LIVE_RECONCILIATION/);
  assert.match(config, /DEFAULT_SHOPLING_LIVE_BATCH_LIMIT = 10/);
  assert.match(config, /MAX_SHOPLING_LIVE_BATCH_LIMIT = 100/);
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

test("live reconcile audit distinguishes dry-run and live gate states within the same hour", async () => {
  const source = await readFile(reconcilePath, "utf8");
  assert.match(source, /configAuditKey/);
  assert.match(source, /shopling1/);
  assert.match(source, /purchase1/);
  assert.match(source, /delete1/);
  assert.match(source, /limit\$\{config\.shoplingLiveBatchLimit\}/);
  assert.match(source, /currentHourKey\(summary\.generatedAt\).*configAuditKey\(summary\.config\)/s);
});

test("lifecycle cron refresh always runs runtime reconcile after policy refresh", async () => {
  const source = await readFile(routePath, "utf8");
  const refreshIndex = source.indexOf("runProductLifecycleRefresh()");
  const reconcileIndex = source.indexOf("runProductLifecycleLiveReconcile(summary.generatedAt)");
  assert.ok(refreshIndex >= 0 && reconcileIndex > refreshIndex);
  assert.match(source, /DELETE는 계속 잠금/);
});

test("runtime gate migration defaults every live control to false, batch limit 10, and remains server-only", async () => {
  const source = await readFile(migrationPath, "utf8");
  assert.match(source, /shopling_non_destructive_live boolean not null default false/);
  assert.match(source, /purchase_stop_live boolean not null default false/);
  assert.match(source, /delete_live boolean not null default false/);
  assert.match(source, /shopling_live_batch_limit integer not null default 10/);
  assert.match(source, /shopling_live_batch_limit between 1 and 100/);
  assert.match(source, /enable row level security/);
  assert.match(source, /revoke all on table public\.product_lifecycle_runtime_config from anon, authenticated/);
});

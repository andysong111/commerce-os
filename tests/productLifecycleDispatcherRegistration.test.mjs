import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [registry, migration, route, runtimeMigration] = await Promise.all([
  read("src/lib/opsAdaptiveDispatcher.ts"),
  read("supabase/migrations/202608310001_product_lifecycle_slot_engine_v1.sql"),
  read("src/app/api/cron/product-lifecycle-refresh/route.ts"),
  read("supabase/migrations/20260901121000_product_lifecycle_runtime_gates_v1.sql"),
]);

test("product lifecycle scheduler is registered in both DB catalog and in-process dispatcher", () => {
  assert.match(registry, /"product-lifecycle-refresh"/);
  assert.match(registry, /routePath: "\/api\/cron\/product-lifecycle-refresh"/);
  assert.match(registry, /import\("@\/app\/api\/cron\/product-lifecycle-refresh\/route"\)/);
  assert.match(migration, /'product-lifecycle-refresh'/);
  assert.match(migration, /'\/api\/cron\/product-lifecycle-refresh'/);
});

test("lifecycle scheduler starts fail-closed and cron delegates live scope to independent runtime gates", () => {
  assert.match(migration, /'product-lifecycle-refresh'[\s\S]*?false,/);
  assert.match(runtimeMigration, /shopling_non_destructive_live boolean not null default false/);
  assert.match(runtimeMigration, /purchase_stop_live boolean not null default false/);
  assert.match(runtimeMigration, /delete_live boolean not null default false/);
  assert.match(route, /runProductLifecycleRefresh/);
  assert.match(route, /runProductLifecycleLiveReconcile\(summary\.generatedAt\)/);
  assert.match(route, /shoplingDirectWrites: false/);
  assert.match(route, /liveReconcile\.config\.shoplingNonDestructiveLive/);
  assert.match(route, /liveReconcile\.config\.purchaseStopLive/);
  assert.match(route, /DELETE는 계속 잠금/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [registry, migration, route] = await Promise.all([
  read("src/lib/opsAdaptiveDispatcher.ts"),
  read("supabase/migrations/202608310001_product_lifecycle_slot_engine_v1.sql"),
  read("src/app/api/cron/product-lifecycle-refresh/route.ts"),
]);

test("product lifecycle scheduler is registered in both DB catalog and in-process dispatcher", () => {
  assert.match(registry, /"product-lifecycle-refresh"/);
  assert.match(registry, /routePath: "\/api\/cron\/product-lifecycle-refresh"/);
  assert.match(registry, /import\("@\/app\/api\/cron\/product-lifecycle-refresh\/route"\)/);
  assert.match(migration, /'product-lifecycle-refresh'/);
  assert.match(migration, /'\/api\/cron\/product-lifecycle-refresh'/);
});

test("lifecycle migration stages task disabled and route defaults to shadow-safe execution", () => {
  assert.match(migration, /'product-lifecycle-refresh'[\s\S]*?false,/);
  assert.match(route, /runProductLifecycleRefresh/);
  assert.match(route, /shoplingDirectWrites: false/);
  assert.match(route, /summary\.mode === "shadow"/);
});

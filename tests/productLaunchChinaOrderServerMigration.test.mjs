import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);
const migration = await readFile(
  new URL(
    "../src/app/api/product-launch-tracker/migrations/china-order-20260812/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("browser no longer runs the one-time China order migration", () => {
  assert.doesNotMatch(app, /stock-sheet-china-order-sync-20260812\.js/);
});

test("server migration is idempotent and explicitly applied", () => {
  assert.match(migration, /const MIGRATION_KEY = "chinaOrderStockSheet20260812"/);
  assert.match(migration, /text\(marker\.status\) === "applied"/);
  assert.match(migration, /searchParams\.get\("apply"\) === "1"/);
  assert.match(migration, /PRODUCT_LAUNCH_MIGRATION_CONCURRENT_UPDATE/);
});

test("single model target tolerates product-name drift while duplicate models require exact product name", () => {
  assert.match(migration, /if \(candidates\.length === 1\)/);
  assert.match(migration, /normalizeProduct\(candidate\.productName\) === productName/);
  assert.match(migration, /ambiguousModels\.push/);
});

test("migration fills China links and China option names without inventing missing sale options", () => {
  assert.match(migration, /next\.chinaProductLinks = mergedLinks/);
  assert.match(migration, /next\.primaryChinaProductLink = primaryUrl/);
  assert.match(migration, /return \{ \.\.\.option, chinaOption: mapped \}/);
  assert.match(migration, /출시관리 판매옵션이 없어 중국옵션명을 안전하게 연결하지 않았습니다/);
});

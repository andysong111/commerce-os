import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);
const controlPlane = await readFile(
  new URL("../public/product-launch-tracker-app/product-master-control-plane.js", import.meta.url),
  "utf8",
);
const coreRoute = await readFile(
  new URL(
    "../src/app/api/product-launch-tracker/product-master-core/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const optimizedRoute = await readFile(
  new URL(
    "../src/app/api/product-launch-tracker/optimized/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const stateRoute = await readFile(
  new URL("../src/app/api/product-launch-tracker/state/route.ts", import.meta.url),
  "utf8",
);
const migration = await readFile(
  new URL(
    "../supabase/migrations/20260817091000_product_launch_hot_read_indexes.sql",
    import.meta.url,
  ),
  "utf8",
);

test("상품마스터 control plane은 workflow app보다 먼저 로드된다", () => {
  const masterIndex = app.indexOf('import("./product-master-control-plane.js")');
  const optimizedIndex = app.indexOf('import("./optimized-app.js")');
  assert.ok(masterIndex >= 0);
  assert.ok(optimizedIndex > masterIndex);
});

test("상품상세에서 Product Master 핵심 원장 deep link를 제공한다", () => {
  assert.match(controlPlane, /상품마스터에서 이 상품 핵심 원장 확인하기/);
  assert.match(controlPlane, /commerce-os-product-master\.vercel\.app/);
  assert.match(controlPlane, /\/core\/\$\{encodeURIComponent\(model\)\}/);
});

test("Product Master fallback은 서버 페이지네이션과 백오프 재연결을 사용한다", () => {
  assert.match(controlPlane, /MASTER_FALLBACK_DELAY_MS = 2_500/);
  assert.match(controlPlane, /MASTER_PAGE_SIZE = 25/);
  assert.match(controlPlane, /WORKFLOW_RECONNECT_DELAYS_MS = \[5_000, 10_000, 20_000, 30_000\]/);
  assert.match(controlPlane, /WORKFLOW_CACHE_MAX_ITEMS = 5_000/);
  assert.match(controlPlane, /pageSize: String\(MASTER_PAGE_SIZE\)/);
  assert.match(controlPlane, /scheduleWorkflowReconnect/);
  assert.match(controlPlane, /lockWorkflowWrites\(true\)/);
  assert.match(controlPlane, /data-master-core-model/);
});

test("OPS proxy는 Product Master 전체 snapshot 대신 paginated core API를 사용한다", () => {
  assert.match(coreRoute, /api\/integrations\/core-page/);
  assert.match(coreRoute, /MAX_PAGE_SIZE = 100/);
  assert.match(coreRoute, /PRODUCT_MASTER_TIMEOUT_MS = 5_000/);
  assert.doesNotMatch(coreRoute, /loadProductPlanningSnapshot/);
});

test("Workflow hot read는 normalized tables 우선·4초 fail-fast·dual write sync를 사용한다", () => {
  assert.match(optimizedRoute, /HUMAN_READ_TIMEOUT_MS = 4_000/);
  assert.match(optimizedRoute, /queryProductLaunchNormalizedPage/);
  assert.match(optimizedRoute, /readProductLaunchNormalizedItem/);
  assert.match(optimizedRoute, /syncProductLaunchNormalizedChangedItems/);
  assert.match(optimizedRoute, /normalized_read_enabled === true/);
  assert.match(optimizedRoute, /attempts: 1, timeoutMs: HUMAN_READ_TIMEOUT_MS/);
  assert.match(stateRoute, /syncProductLaunchNormalizedFull/);
  assert.match(stateRoute, /syncProductLaunchNormalizedChangedItems/);
});

test("normalized list search and hot sort/filter columns are indexed", () => {
  assert.match(migration, /product_launch_items_search_text_trgm_idx/);
  assert.match(migration, /product_launch_items_assignees_gin_idx/);
  assert.match(migration, /product_launch_items_owner_detail_page_idx/);
  assert.match(migration, /product_launch_items_owner_inventory_reflection_idx/);
});

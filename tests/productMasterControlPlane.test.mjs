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

test("OPS DB 지연 시 Product Master 독립 원장을 읽기 전용 fallback으로 표시한다", () => {
  assert.match(controlPlane, /MASTER_FALLBACK_DELAY_MS = 3_000/);
  assert.match(controlPlane, /Product Master 핵심 원장 표시 · OPS Workflow 재연결 대기/);
  assert.match(controlPlane, /lockWorkflowWrites\(true\)/);
  assert.match(controlPlane, /data-master-core-model/);
  assert.match(coreRoute, /loadProductPlanningSnapshot/);
  assert.match(coreRoute, /unstable_cache/);
  assert.match(coreRoute, /core-ledger-fallback/);
});

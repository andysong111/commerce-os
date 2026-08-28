import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const gateUrl = new URL(
  "../public/product-launch-tracker-app/workflow-ui-gate.js",
  import.meta.url,
);
const pageUrl = new URL(
  "../src/app/product-launch-tracker/page.tsx",
  import.meta.url,
);
const recoveryRouteUrl = new URL(
  "../src/app/api/product-launch-tracker/recovery-page/route.ts",
  import.meta.url,
);
const healthWrapperUrl = new URL(
  "../public/product-launch-tracker-app/china-link-health-panel.js",
  import.meta.url,
);

test("상품출시 Workflow gate는 단일 snapshot 복구 read를 사용하고 짧게 재시도한다", async () => {
  const source = await readFile(gateUrl, "utf8");

  assert.match(
    source,
    /const WORKFLOW_API = "\/api\/product-launch-tracker\/recovery-page";/,
  );
  assert.match(source, /const PROBE_TIMEOUT_MS = 5_000;/);
  assert.match(source, /const IDLE_RETRY_MS = 5_000;/);
  assert.doesNotMatch(source, /const IDLE_RETRY_MS = 30_000;/);
});

test("snapshot probe 결과를 normalized/optimized UI 첫 조회에도 warm handoff한다", async () => {
  const source = await readFile(gateUrl, "utf8");
  assert.match(source, /WORKFLOW_COMPATIBLE_PATHS/);
  assert.match(source, /\/api\/product-launch-tracker\/normalized-optimized/);
  assert.match(source, /\/api\/product-launch-tracker\/optimized/);
  assert.match(source, /WORKFLOW_COMPATIBLE_PATHS\.has\(left\.pathname\)/);
  assert.match(source, /WORKFLOW_COMPATIBLE_PATHS\.has\(right\.pathname\)/);
});

test("복구 endpoint는 normalized 목록을 건드리지 않고 저장된 list snapshot만 읽는다", async () => {
  const source = await readFile(recoveryRouteUrl, "utf8");
  assert.match(source, /PRODUCT_LAUNCH_LIST_SNAPSHOT_FIELD/);
  assert.match(source, /buildProductLaunchListIndex/);
  assert.match(source, /queryProductLaunchListPage/);
  assert.match(source, /attempts: 1/);
  assert.match(source, /timeoutMs: RECOVERY_READ_TIMEOUT_MS/);
  assert.doesNotMatch(source, /queryProductLaunchNormalizedPage/);
  assert.doesNotMatch(source, /readProductLaunchNormalizedWorkspace/);
});

test("1688 링크 건강진단은 핵심 출시 화면에서 자동 DB 조회하지 않고 수동으로 lazy-load한다", async () => {
  const source = await readFile(healthWrapperUrl, "utf8");
  assert.match(source, /china-link-health-panel-full\.js/);
  assert.match(source, /1688 링크 진단 열기/);
  assert.doesNotMatch(source, /HEALTH_API/);
  assert.doesNotMatch(source, /loadSummary\(\)/);
});

test("상품출시 페이지 asset version은 snapshot recovery 수정본을 구분한다", async () => {
  const source = await readFile(pageUrl, "utf8");
  assert.match(source, /workflow-snapshot-recovery-v1/);
});

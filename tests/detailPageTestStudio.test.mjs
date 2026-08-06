import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  moduleCard,
  moduleRegistry,
  workspace,
  page,
  bridge,
  route,
  service,
  cron,
  productionStart,
] = await Promise.all([
  readFile("src/lib/detailPageTestStudioModule.ts", "utf8"),
  readFile("src/lib/opsModuleRegistry.ts", "utf8"),
  readFile("src/lib/opsWorkspace.ts", "utf8"),
  readFile("src/app/detail-page-studio-test/page.tsx", "utf8"),
  readFile("src/app/detail-page-studio-test/TestStudioBridge.tsx", "utf8"),
  readFile("src/app/api/detail-page-studio-test/jobs/route.ts", "utf8"),
  readFile("src/lib/detailPageTestStudio.ts", "utf8"),
  readFile("src/app/api/cron/detail-page-jobs/route.ts", "utf8"),
  readFile(
    "src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/start/route.ts",
    "utf8",
  ),
]);

test("dashboard exposes a separate Detail Page Studio test card", () => {
  assert.match(moduleCard, /id: "detail-page-studio-test"/);
  assert.match(moduleCard, /title: "상세페이지 스튜디오 테스트버전"/);
  assert.match(moduleCard, /route: "\/detail-page-studio-test"/);
  assert.match(moduleCard, /기존 운영 엔진과 분리/);
  assert.match(moduleRegistry, /detailPageTestStudioModule/);
  assert.match(workspace, /"detail-page-studio-test"/);
  assert.match(workspace, /"content-keyword"/);
});

test("Ops wrapper embeds only the configured standalone test repository deployment", () => {
  assert.match(page, /NEXT_PUBLIC_DETAIL_PAGE_STUDIO_TEST_URL/);
  assert.match(page, /new-product-detail-ai\.vercel\.app/);
  assert.match(bridge, /event\.origin !== studio\.origin/);
  assert.match(bridge, /event\.source !== iframeRef\.current\?\.contentWindow/);
  assert.match(bridge, /detail-page-test-submit/);
  assert.match(bridge, /\/api\/detail-page-studio-test\/jobs/);
  assert.match(bridge, /commerce-os-detail-page-test-result/);
});

test("test intake uses the existing durable detail-page review job table contract", () => {
  assert.match(route, /resolveDetailPageJobIdentity/);
  assert.match(route, /getDetailPageJobConfig/);
  assert.match(route, /createDetailPageTestStudioJob/);
  assert.match(service, /kind: "detail_page"/);
  assert.match(service, /engine_variant: DETAIL_PAGE_TEST_ENGINE_VARIANT/);
  assert.match(service, /stage: "test_input_registered"/);
  assert.match(service, /status: "queued"/);
  assert.match(service, /evidence_urls: evidence\.urls/);
  assert.match(service, /product-launch-assets/);
  assert.match(service, /MAX_IMAGE_BYTES = 900_000/);
});

test("test jobs cannot leak into the current production worker", () => {
  assert.match(cron, /!isDetailPageTestJob\(job\.payload\)/);
  assert.match(cron, /skipped_test_jobs/);
  assert.match(productionStart, /isDetailPageTestJob\(job\.payload\)/);
  assert.match(productionStart, /DETAIL_PAGE_TEST_ENGINE_REQUIRED/);
  assert.match(productionStart, /기존 운영 상세페이지 Worker 실행을 차단했습니다/);
});

test("test intake never mutates Shopling, inventory, price, or procurement data", () => {
  assert.doesNotMatch(
    `${route}\n${service}`,
    /shopling-price|price-modify|inventory_movements|1688.*order|receipt.*confirm|stock.*write/i,
  );
});

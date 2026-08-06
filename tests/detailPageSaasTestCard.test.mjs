import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [moduleFile, registryFile, dashboardFile, pageFile] = await Promise.all([
  readFile("src/lib/detailPageSaasTestModule.ts", "utf8"),
  readFile("src/lib/opsModuleRegistry.ts", "utf8"),
  readFile("src/components/dashboard/OpsDashboardWithSaasTestClone.tsx", "utf8"),
  readFile("src/app/page.tsx", "utf8"),
]);

test("SaaS test card reuses the exact production Studio route and description", () => {
  assert.match(moduleFile, /id: "detail-page-studio-saas-test"/);
  assert.match(
    moduleFile,
    /title: "Commerce OS Detail Page Studio · SaaS\(테스트버전\)"/,
  );
  assert.match(
    moduleFile,
    /route: "https:\/\/commerce-os-detail-page-studio\.vercel\.app\/"/,
  );
  assert.match(moduleFile, /표준 생성 프로필에 따라 8개 섹션/);
  assert.match(moduleFile, /AI 검수된 8개 섹션 상세페이지/);
});

test("content workspace renders original and duplicated SaaS cards together", () => {
  assert.match(registryFile, /detailPageSaasTestModule/);
  assert.match(dashboardFile, /"detail-page-studio"/);
  assert.match(dashboardFile, /"detail-page-studio-saas-test"/);
  assert.match(dashboardFile, /selectedGroupId !== "content-keyword"/);
  assert.match(pageFile, /OpsDashboardWithSaasTestClone/);
  assert.match(pageFile, /opsModuleRegistry/);
});

test("removed custom test intake is not part of the replacement branch", () => {
  assert.doesNotMatch(moduleFile, /detail-page-studio-test/);
  assert.doesNotMatch(moduleFile, /new-product-detail-ai-test-v1/);
  assert.doesNotMatch(dashboardFile, /테스트 입력을 기다리고 있습니다/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [moduleFile, registryFile, dashboardFile, pageFile] = await Promise.all([
  readFile("src/lib/detailPageSaasTestModule.ts", "utf8"),
  readFile("src/lib/opsModuleRegistry.ts", "utf8"),
  readFile("src/components/dashboard/OpsDashboardWithSaasTestClone.tsx", "utf8"),
  readFile("src/app/page.tsx", "utf8"),
]);

test("SaaS test card uses the production Studio with an isolated test mode", () => {
  assert.match(moduleFile, /id: "detail-page-studio-saas-test"/);
  assert.match(
    moduleFile,
    /title: "Commerce OS Detail Page Studio · SaaS\(테스트버전\)"/,
  );
  assert.match(
    moduleFile,
    /route:\s*\n\s*"https:\/\/commerce-os-detail-page-studio\.vercel\.app\/\?studio_variant=saas-test"/,
  );
  assert.match(moduleFile, /표준 생성 프로필에 따라 8개 섹션/);
  assert.match(moduleFile, /1688 링크 입력의 모델명은 선택한 문구 언어/);
});

test("content workspace renders original and SaaS test cards together", () => {
  assert.match(registryFile, /detailPageSaasTestModule/);
  assert.doesNotMatch(registryFile, /detailPageTestStudioModule/);
  assert.match(dashboardFile, /"detail-page-studio"/);
  assert.match(dashboardFile, /"detail-page-studio-saas-test"/);
  assert.match(dashboardFile, /selectedGroupId !== "content-keyword"/);
  assert.match(pageFile, /OpsDashboardWithSaasTestClone/);
  assert.match(pageFile, /opsModuleRegistry/);
});

test("obsolete custom test card is no longer registered", () => {
  assert.doesNotMatch(moduleFile, /id: "detail-page-studio-test"/);
  assert.doesNotMatch(moduleFile, /상세페이지 스튜디오 테스트버전/);
  assert.doesNotMatch(registryFile, /detailPageTestStudioModule/);
});

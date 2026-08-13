import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [baselineFile, moduleFile, datedModuleFile, registryFile, dashboardFile, pageFile] =
  await Promise.all([
    readFile("src/lib/detailPageV3ProductionBaseline.ts", "utf8"),
    readFile("src/lib/detailPageSaasTestModule.ts", "utf8"),
    readFile("src/lib/detailPageSaasTest260807Module.ts", "utf8"),
    readFile("src/lib/opsModuleRegistry.ts", "utf8"),
    readFile("src/components/dashboard/OpsDashboardWithSaasTestClone.tsx", "utf8"),
    readFile("src/app/page.tsx", "utf8"),
  ]);

test("detail studio routes keep the frozen OPS source-first-v3 contract", () => {
  assert.match(baselineFile, /engineProfile: "source-first-v3"/);
  assert.match(baselineFile, /stable\/v260807-highpoint-20260810/);
  assert.match(
    baselineFile,
    /bc3666b093e3c05aba605382ca8e3a798e02f42d/,
  );
  assert.match(moduleFile, /DETAIL_PAGE_V3_BASELINE_NOTE/);
  assert.match(datedModuleFile, /DETAIL_PAGE_V3_BASELINE_NOTE/);
  assert.match(registryFile, /DETAIL_PAGE_V3_BASELINE_NOTE/);
  assert.match(registryFile, /OPS source-first-v3/);
});

test("OPS Center internal v260807 card keeps the production Studio host", () => {
  assert.match(moduleFile, /id: "detail-page-studio-saas-test"/);
  assert.match(
    moduleFile,
    /commerce-os-detail-page-studio\.vercel\.app\/\?studio_variant=saas-test/,
  );
});

test("SaaS production card opens the standalone SaaS production app", () => {
  assert.match(
    registryFile,
    /title: "Commerce OS Detail Page Studio · SaaS 전용 · Production"/,
  );
  assert.match(
    registryFile,
    /route: "https:\/\/commerce-os-detail-page-saas\.vercel\.app\/"/,
  );
  assert.doesNotMatch(
    registryFile,
    /commerce-os-detail-page-studio-git-isolated-sa-3f377e-a2bsangsa\.vercel\.app/,
  );
  assert.match(registryFile, /Standalone SaaS Production · OPS V3/);
  assert.match(registryFile, /결과 6개 저장/);
});

test("SaaS test card remains isolated from standalone production", () => {
  assert.match(
    datedModuleFile,
    /id: "detail-page-studio-saas-test-260807"/,
  );
  assert.match(
    datedModuleFile,
    /commerce-os-detail-page-studio-git-isolated-saas-test-a2bsangsa\.vercel\.app\/\?studio_variant=saas-test/,
  );
});

test("three detail studio cards remain registered with separate runtime routes", () => {
  assert.match(registryFile, /detailPageSaasTestModule/);
  assert.match(registryFile, /detailPageSaasTest260807Module/);
  assert.match(dashboardFile, /"detail-page-studio"/);
  assert.match(dashboardFile, /"detail-page-studio-saas-test"/);
  assert.match(dashboardFile, /"detail-page-studio-saas-test-260807"/);
  assert.match(pageFile, /OpsDashboardWithSaasTestClone/);
  assert.match(pageFile, /opsModuleRegistry/);
  assert.match(moduleFile, /commerce-os-detail-page-studio\.vercel\.app/);
  assert.match(registryFile, /commerce-os-detail-page-saas\.vercel\.app/);
  assert.match(datedModuleFile, /git-isolated-saas-test/);
});

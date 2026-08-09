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

test("all three v260807 detail studio cards share one frozen Production v3 contract", () => {
  assert.match(baselineFile, /engineProfile: "source-first-v3"/);
  assert.match(baselineFile, /stable\/ops-v3-production-20260809/);
  assert.match(
    baselineFile,
    /48ee179b4c7cd067c93ddbcfa3fd02a2a349796e/,
  );
  assert.match(
    baselineFile,
    /stable\/product-launch-detail-v3-integration-20260809/,
  );
  assert.match(moduleFile, /DETAIL_PAGE_V3_BASELINE_NOTE/);
  assert.match(datedModuleFile, /DETAIL_PAGE_V3_BASELINE_NOTE/);
  assert.match(registryFile, /DETAIL_PAGE_V3_BASELINE_NOTE/);
  assert.match(moduleFile, /Production v3/);
  assert.match(datedModuleFile, /Production v3/);
  assert.match(registryFile, /Production v3/);
});

test("OPS Center v260807 card keeps the production Studio host", () => {
  assert.match(moduleFile, /id: "detail-page-studio-saas-test"/);
  assert.match(
    moduleFile,
    /title: "Commerce OS Detail Page Studio · v260807"/,
  );
  assert.match(
    moduleFile,
    /commerce-os-detail-page-studio\.vercel\.app\/\?studio_variant=saas-test/,
  );
});

test("SaaS production card keeps its deployment alias while using the shared baseline", () => {
  assert.match(
    registryFile,
    /title: "Commerce OS Detail Page Studio · SaaS 전용 · v260807"/,
  );
  assert.match(
    registryFile,
    /commerce-os-detail-page-studio-git-isolated-sa-3f377e-a2bsangsa\.vercel\.app\/\?studio_variant=saas-test/,
  );
  assert.match(registryFile, /isolated\/saas-production/);
});

test("SaaS test card keeps its deployment alias while using the shared baseline", () => {
  assert.match(
    datedModuleFile,
    /id: "detail-page-studio-saas-test-260807"/,
  );
  assert.match(
    datedModuleFile,
    /title: "Commerce OS Detail Page Studio · SaaS\(테스트버전\) · v260807"/,
  );
  assert.match(
    datedModuleFile,
    /commerce-os-detail-page-studio-git-isolated-saas-test-a2bsangsa\.vercel\.app\/\?studio_variant=saas-test/,
  );
  assert.match(datedModuleFile, /isolated\/saas-test/);
});

test("three detail studio cards remain registered together with separate runtime routes", () => {
  assert.match(registryFile, /detailPageSaasTestModule/);
  assert.match(registryFile, /detailPageSaasTest260807Module/);
  assert.match(dashboardFile, /"detail-page-studio"/);
  assert.match(dashboardFile, /"detail-page-studio-saas-test"/);
  assert.match(dashboardFile, /"detail-page-studio-saas-test-260807"/);
  assert.match(dashboardFile, /selectedGroupId !== "content-keyword"/);
  assert.match(pageFile, /OpsDashboardWithSaasTestClone/);
  assert.match(pageFile, /opsModuleRegistry/);
  assert.match(moduleFile, /commerce-os-detail-page-studio\.vercel\.app/);
  assert.match(registryFile, /git-isolated-sa-3f377e/);
  assert.match(datedModuleFile, /git-isolated-saas-test/);
});

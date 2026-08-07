import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [moduleFile, datedModuleFile, registryFile, dashboardFile, pageFile] =
  await Promise.all([
    readFile("src/lib/detailPageSaasTestModule.ts", "utf8"),
    readFile("src/lib/detailPageSaasTest260807Module.ts", "utf8"),
    readFile("src/lib/opsModuleRegistry.ts", "utf8"),
    readFile("src/components/dashboard/OpsDashboardWithSaasTestClone.tsx", "utf8"),
    readFile("src/app/page.tsx", "utf8"),
  ]);

test("OPS Center detail studio uses its isolated engine line", () => {
  assert.match(moduleFile, /id: "detail-page-studio-saas-test"/);
  assert.match(
    moduleFile,
    /title: "Commerce OS Detail Page Studio · v260807"/,
  );
  assert.match(moduleFile, /OPS Center 전용/);
  assert.match(
    moduleFile,
    /commerce-os-detail-page-studio-git-isolated-ops-center-a2bsangsa\.vercel\.app\/\?studio_variant=saas-test/,
  );
  assert.match(moduleFile, /isolated\/ops-center/);
});

test("SaaS production detail studio uses its isolated engine line", () => {
  assert.match(
    registryFile,
    /title: "Commerce OS Detail Page Studio · SaaS 전용 · v260807"/,
  );
  assert.match(
    registryFile,
    /commerce-os-detail-page-studio-git-isolated-saas-production-a2bsangsa\.vercel\.app\/\?studio_variant=saas-test/,
  );
  assert.match(registryFile, /isolated\/saas-production/);
});

test("SaaS test detail studio uses its isolated engine line", () => {
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

test("three detail studio cards remain registered together", () => {
  assert.match(registryFile, /detailPageSaasTestModule/);
  assert.match(registryFile, /detailPageSaasTest260807Module/);
  assert.match(dashboardFile, /"detail-page-studio"/);
  assert.match(dashboardFile, /"detail-page-studio-saas-test"/);
  assert.match(dashboardFile, /"detail-page-studio-saas-test-260807"/);
  assert.match(dashboardFile, /selectedGroupId !== "content-keyword"/);
  assert.match(pageFile, /OpsDashboardWithSaasTestClone/);
  assert.match(pageFile, /opsModuleRegistry/);
});

test("all three cards start from the same v260807 quality baseline but use different routes", () => {
  assert.match(moduleFile, /v260807/);
  assert.match(datedModuleFile, /v260807/);
  assert.match(registryFile, /v260807/);
  assert.doesNotMatch(
    moduleFile,
    /commerce-os-detail-page-studio\.vercel\.app\/\?studio_variant=saas-test/,
  );
  assert.doesNotMatch(
    datedModuleFile,
    /commerce-os-detail-page-studio\.vercel\.app\/\?studio_variant=saas-test/,
  );
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const createRoute = readFileSync(
  new URL("../app/api/product-launch-tracker/detail-page-jobs/route.ts", import.meta.url),
  "utf8",
);
const startRoute = readFileSync(
  new URL("../app/api/product-launch-tracker/detail-page-jobs/[jobId]/start/route.ts", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL("../app/product-launch-tracker/page.tsx", import.meta.url),
  "utf8",
);
const control = readFileSync(
  new URL("../components/product-launch-flow/ProductLaunchEvidenceCompilerCanary.tsx", import.meta.url),
  "utf8",
);
const appShell = readFileSync(
  new URL("../components/AppShell.tsx", import.meta.url),
  "utf8",
);
const parallelWorkers = readFileSync(
  new URL("../components/DetailPageCompilerParallelWorkers.tsx", import.meta.url),
  "utf8",
);

describe("Retired Product Launch Evidence Compiler canary UI", () => {
  it("keeps Compiler backend compatibility for old jobs without exposing the Product Launch trigger", () => {
    expect(createRoute).toContain("compiler_canary: input.compilerCanary");
    expect(startRoute).toContain("job.payload.compiler_canary === true");
    expect(control).toContain("Evidence Compiler v1 · 다중 신규 생성");
    expect(page).not.toContain("ProductLaunchEvidenceCompilerCanary");
  });

  it("keeps archived parallel worker code but does not mount it in the global app shell", () => {
    expect(parallelWorkers).toContain("DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE - 1");
    expect(appShell).not.toContain("DetailPageCompilerParallelWorkers");
  });

  it("keeps the normal Product Launch tracker and selected-detail-page workflow mounted", () => {
    expect(page).toContain('title="신규 상품 출시 진행관리"');
    expect(page).toContain('detail_page_mode: "client"');
    expect(page).toContain("ProductLaunchTrackerCanonicalPriceBridge");
    expect(page).toContain("ProductMasterSyncButton");
  });
});

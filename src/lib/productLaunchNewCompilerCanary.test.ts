import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const createRoute = readFileSync(
  new URL(
    "../app/api/product-launch-tracker/detail-page-jobs/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const startRoute = readFileSync(
  new URL(
    "../app/api/product-launch-tracker/detail-page-jobs/[jobId]/start/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const page = readFileSync(
  new URL("../app/product-launch-tracker/page.tsx", import.meta.url),
  "utf8",
);
const control = readFileSync(
  new URL(
    "../components/product-launch-flow/ProductLaunchEvidenceCompilerCanary.tsx",
    import.meta.url,
  ),
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
const dock = readFileSync(
  new URL("../../public/product-launch-tracker-app/detail-page-dock.js", import.meta.url),
  "utf8",
);

describe("Product Launch multi-item Evidence Compiler", () => {
  it("persists Compiler intent and explicit collection slot on every durable job", () => {
    expect(createRoute).toContain("compilerCanary: boolean");
    expect(createRoute).toContain("compilerWorkerSlot: number | null");
    expect(createRoute).toContain("body?.compilerCanary === true");
    expect(createRoute).toContain("compiler_canary: input.compilerCanary");
    expect(createRoute).toContain("compiler_worker_slot: input.compilerWorkerSlot");
    expect(createRoute).toContain("compiler_canary_created_at");
    expect(control).toContain("compilerCanary: true");
    expect(control).toContain(
      "compilerWorkerSlot = batchIndex % DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE",
    );
  });

  it("keeps a non-terminal persisted Compiler job on the Compiler worker", () => {
    expect(startRoute).toContain("const persistedCompilerCanary =");
    expect(startRoute).toContain("job.payload.compiler_canary === true");
    expect(startRoute).toContain(
      "const compilerCanary = explicitCompilerCanary || persistedCompilerCanary",
    );
    expect(startRoute).toContain(
      'workerUrl.searchParams.set(COMPILER_CANARY_PARAMETER, "1")',
    );
  });

  it("accepts one or more checked products instead of requiring exactly one", () => {
    expect(page).toContain("ProductLaunchEvidenceCompilerCanary");
    expect(control).toContain("Evidence Compiler v1 · 다중 신규 생성");
    expect(control).toContain('if (!selectedIds.length)');
    expect(control).not.toContain("selectedIds.length !== 1");
    expect(control).toContain("체크 상품 Compiler 생성");
    expect(control).toContain("mapWithConcurrency");
    expect(control).toContain("activeItemIds");
    expect(control).toContain("이미 진행 중");
  });

  it("mounts two extra collectors and routes the first three Compiler jobs to distinct persisted slots", () => {
    expect(appShell).toContain("DetailPageCompilerParallelWorkers");
    expect(parallelWorkers).toContain("DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE - 1");
    expect(parallelWorkers).toContain("compiler_worker_slot=${slot}");
    expect(parallelWorkers).toContain("compiler_worker_slots=${DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE}");
    expect(dock).toContain("COMPILER_WORKER_SLOT_RAW");
    expect(dock).toContain("compilerWorkerSlotForItem");
    expect(dock).toContain("persistedCompilerWorkerSlot");
    expect(dock).toContain("job?.payload?.compiler_canary === true");
    expect(dock).toContain("function workerOwnsJob(job)");
    expect(dock).toContain("if (!isCompilerJob(job)) return !COMPILER_WORKER_EXPLICIT");
    expect(dock).toContain(
      "persistedSlot ?? compilerWorkerSlotForItem(job?.itemId)",
    );
    expect(dock).toContain("!workerOwnsJob(server)");
    expect(dock).toContain("if (!workerOwnsJob(job)) continue");
  });

  it("preserves existing product detail assets until each new job reaches normal final_complete docking", () => {
    expect(control).toContain("detailPageAutomation: automation");
    expect(control).not.toContain("detailPageAsset:");
    expect(control).toContain("기존 상품상세 이미지/HTML은 각 새 결과가 최종 PASS할 때만 교체됩니다.");
  });

  it("keeps normal selection generation explicitly labeled as the v3 rollback path", () => {
    expect(control).toContain("일반 ‘선택 상세페이지 생성’은 v3 롤백 경로로 유지합니다.");
  });
});

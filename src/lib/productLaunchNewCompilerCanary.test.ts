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

describe("Product Launch new-item Evidence Compiler canary", () => {
  it("persists Compiler intent on the durable job from creation", () => {
    expect(createRoute).toContain("compilerCanary: boolean");
    expect(createRoute).toContain("body?.compilerCanary === true");
    expect(createRoute).toContain("compiler_canary: input.compilerCanary");
    expect(createRoute).toContain("compiler_canary_created_at");
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

  it("mounts a separate one-item canary control without replacing the normal detail-page button", () => {
    expect(page).toContain("ProductLaunchEvidenceCompilerCanary");
    expect(control).toContain("Evidence Compiler v1 · 신규 1건 카나리");
    expect(control).toContain("selectedIds.length !== 1");
    expect(control).toContain("compilerCanary: true");
    expect(control).toContain("일반 ‘선택 상세페이지 생성’은 기존 v3 그대로 유지됩니다.");
  });

  it("preserves existing product detail assets until the new job reaches normal final_complete docking", () => {
    expect(control).toContain("detailPageAutomation: automation");
    expect(control).not.toContain("detailPageAsset:");
    expect(control).toContain("기존 상품상세 이미지/HTML은 새 결과가 최종 PASS할 때만 교체됩니다.");
  });
});

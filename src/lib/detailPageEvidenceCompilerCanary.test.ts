import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const startRoute = readFileSync(
  new URL(
    "../app/api/product-launch-tracker/detail-page-jobs/[jobId]/start/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const connection = readFileSync(
  new URL("./detailPageStudioConnection.ts", import.meta.url),
  "utf8",
);
const canaryControl = readFileSync(
  new URL(
    "../components/detail-page-ai-review/DetailPageCompilerCanaryControl.tsx",
    import.meta.url,
  ),
  "utf8",
);
const reviewPage = readFileSync(
  new URL("../app/detail-page-ai-review/page.tsx", import.meta.url),
  "utf8",
);

describe("Product Launch Evidence Compiler canary", () => {
  it("keeps the normal Product Launch Studio connection pinned to production", () => {
    expect(connection).toContain(
      '"https://commerce-os-detail-page-studio.vercel.app/"',
    );
    expect(connection).toContain(
      "const OPS_CENTER_V260807_STUDIO_URL = PRODUCTION_STUDIO_URL",
    );
  });

  it("requires a dedicated action before adding the compiler canary handshake", () => {
    expect(startRoute).toContain(
      'const COMPILER_CANARY_ACTION = "compiler_v1_canary"',
    );
    expect(startRoute).toContain(
      'const compilerCanary = command.action === COMPILER_CANARY_ACTION',
    );
    expect(startRoute).toContain(
      'workerUrl.searchParams.set(COMPILER_CANARY_PARAMETER, "1")',
    );
    expect(startRoute).toContain(
      "compilerCanary: compilerCanary || undefined",
    );
  });

  it("reuses stored evidence for terminal canaries instead of recollecting", () => {
    expect(startRoute).toContain("TERMINAL_STATUSES.has(job.status)");
    expect(startRoute).toContain("job.payload.evidence_urls");
    expect(startRoute).toContain("analysisRecord.product");
    expect(startRoute).toContain('stage: "compiler_v1_canary"');
    expect(startRoute).toContain("compiler_canary_started_at");
    expect(startRoute).toContain("execution_id: executionId");
  });

  it("clears every Compiler-only checkpoint before a repeated canary while preserving evidence and analysis", () => {
    expect(startRoute).toContain("compilerV1PreflightReady: null");
    expect(startRoute).toContain("compilerProductPack: null");
    expect(startRoute).toContain("compilerBlueprint: null");
    expect(startRoute).toContain("compilerPreflight: null");
    expect(startRoute).toContain("compilerRasterGate: null");
    expect(startRoute).toContain("compilerRasterTileCount: null");
    expect(startRoute).toContain("compilerArtifactState: null");
    expect(startRoute).toContain("compilerFinalSize: null");
    expect(startRoute).toContain("compilerSelectedSourceIndexes: null");
    expect(startRoute).not.toContain("evidence_urls: null");
    expect(startRoute).not.toContain("analysis: null");
  });

  it("does not replace the shared worker URL or Studio origin", () => {
    expect(startRoute).toContain(
      "const connection = resolveDetailPageStudioConnection()",
    );
    expect(startRoute).toContain("const workerUrl = new URL(connection.workerUrl)");
    expect(startRoute).not.toContain("commerce-os-detail-page-studio-git-rebuild");
  });

  it("mounts a one-job review-page control with an explicit canary action", () => {
    expect(reviewPage).toContain("DetailPageCompilerCanaryControl");
    expect(canaryControl).toContain("Evidence Compiler v1 · 1건 카나리");
    expect(canaryControl).toContain('JSON.stringify({ action: "compiler_v1_canary" })');
    expect(canaryControl).toContain("기존 상품출시진행관리 이미지 URL/HTML은 새 결과가 최종 PASS하기 전까지 유지됩니다.");
  });
});

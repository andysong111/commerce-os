import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const startRoute = readFileSync(
  new URL("../app/api/product-launch-tracker/detail-page-jobs/[jobId]/start/route.ts", import.meta.url),
  "utf8",
);
const connection = readFileSync(
  new URL("./detailPageStudioConnection.ts", import.meta.url),
  "utf8",
);
const canaryControl = readFileSync(
  new URL("../components/detail-page-ai-review/DetailPageCompilerCanaryControl.tsx", import.meta.url),
  "utf8",
);
const reviewPage = readFileSync(
  new URL("../app/detail-page-ai-review/page.tsx", import.meta.url),
  "utf8",
);

describe("Retired Evidence Compiler canary UI", () => {
  it("keeps the normal Product Launch Studio connection pinned to production", () => {
    expect(connection).toContain('"https://commerce-os-detail-page-studio.vercel.app/"');
    expect(connection).toContain("const OPS_CENTER_V260807_STUDIO_URL = PRODUCTION_STUDIO_URL");
  });

  it("retains Compiler backend compatibility for historical jobs without mounting the review-page trigger", () => {
    expect(startRoute).toContain('const COMPILER_CANARY_ACTION = "compiler_v1_canary"');
    expect(startRoute).toContain("job.payload.compiler_canary === true");
    expect(canaryControl).toContain("Evidence Compiler v1 · 1건 카나리");
    expect(reviewPage).not.toContain("DetailPageCompilerCanaryControl");
  });

  it("keeps the ordinary review, regeneration, download, and workspace controls visible", () => {
    expect(reviewPage).toContain("DetailPageActiveJobControlsV2");
    expect(reviewPage).toContain("DetailPageTerminalJobControls");
    expect(reviewPage).toContain("DetailPageRepresentativeDownloadControl");
    expect(reviewPage).toContain("DetailPageAiReviewWorkspace");
  });
});

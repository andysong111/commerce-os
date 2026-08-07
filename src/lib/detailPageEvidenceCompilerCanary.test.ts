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

  it("does not replace the shared worker URL or Studio origin", () => {
    expect(startRoute).toContain(
      "const connection = resolveDetailPageStudioConnection()",
    );
    expect(startRoute).toContain("const workerUrl = new URL(connection.workerUrl)");
    expect(startRoute).not.toContain("commerce-os-detail-page-studio-git-rebuild");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(
  new URL("../../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);
const repair = readFileSync(
  new URL(
    "../../public/product-launch-tracker-app/detail-page-dock-repair.js",
    import.meta.url,
  ),
  "utf8",
);
const scope = readFileSync(
  new URL(
    "../../public/product-launch-tracker-app/detail-page-product-scope.js",
    import.meta.url,
  ),
  "utf8",
);
const download = readFileSync(
  new URL(
    "../components/detail-page-ai-review/DetailPageRepresentativeDownloadControl.tsx",
    import.meta.url,
  ),
  "utf8",
);

describe("product launch detail-page durable docking repair", () => {
  it("loads the seller scope bridge before the collection worker and loads dock repair in both modes", () => {
    const workerScope = app.indexOf('import("./detail-page-product-scope.js")');
    const workerDock = app.indexOf('import("./detail-page-dock.js")');
    expect(workerScope).toBeGreaterThanOrEqual(0);
    expect(workerDock).toBeGreaterThan(workerScope);
    expect(app.match(/detail-page-dock-repair\.js/g)?.length).toBe(2);
  });

  it("rebuilds HTML and URL fields from successful durable job results", () => {
    expect(repair).toContain('job.status !== "success"');
    expect(repair).toContain("detailPageAsset");
    expect(repair).toContain("detailPageAutomation");
    expect(repair).toContain('operation: "patch_item"');
    expect(repair).toContain("buildDetailHtml");
  });

  it("adds optional authoritative seller shipment scope and injects it into evidence analysis", () => {
    expect(scope).toContain("상세페이지 실제 발송구성");
    expect(scope).toContain("SELLER-CONFIRMED SHIPMENT SCOPE");
    expect(scope).toContain('body?.action !== "evidence_ready"');
    expect(scope).toContain("sourceProductInfo");
  });

  it("labels ZIP choices with launch item id, completion time and short job code", () => {
    expect(download).toContain("job.itemId");
    expect(download).toContain("completedLabel(job)");
    expect(download).toContain("job.jobId.slice(0, 8)");
  });
});

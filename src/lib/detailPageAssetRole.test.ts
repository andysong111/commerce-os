import { describe, expect, it } from "vitest";
import {
  isAllowedDetailPageAssetRole,
  normalizeDetailPageAssetRole,
} from "./detailPageAssetRole";

describe("detail-page v3 asset-role compatibility", () => {
  it("maps representative roles onto the existing main and additional slots", () => {
    expect(normalizeDetailPageAssetRole("v3-representative-main-catalog")).toBe(
      "main",
    );
    expect(
      normalizeDetailPageAssetRole("v3-representative-alternate-whole"),
    ).toBe("additional-1");
    expect(
      normalizeDetailPageAssetRole("v3-representative-evidence-detail"),
    ).toBe("additional-2");
    expect(
      normalizeDetailPageAssetRole("v3-representative-lifestyle-usage"),
    ).toBe("additional-3");
    expect(
      normalizeDetailPageAssetRole("v3-representative-adaptive-support"),
    ).toBe("additional-4");
  });

  it("maps v3 detail roles onto the existing panel slots", () => {
    expect(normalizeDetailPageAssetRole("v3-hook")).toBe("panel-1");
    expect(normalizeDetailPageAssetRole("v3-point-1-filler")).toBe("panel-2");
    expect(normalizeDetailPageAssetRole("v3-point-2-filler")).toBe("panel-3");
    expect(normalizeDetailPageAssetRole("v3-point-3-filler")).toBe("panel-4");
    expect(normalizeDetailPageAssetRole("v3-usage-filler-1")).toBe("panel-5");
    expect(normalizeDetailPageAssetRole("v3-usage-filler-2")).toBe("panel-6");
    expect(normalizeDetailPageAssetRole("v3-option-filler")).toBe("panel-7");
  });

  it("keeps existing storage roles unchanged and rejects unknown roles", () => {
    expect(normalizeDetailPageAssetRole("main")).toBe("main");
    expect(normalizeDetailPageAssetRole("detail-page")).toBe("detail-page");
    expect(isAllowedDetailPageAssetRole("v3-hook")).toBe(true);
    expect(isAllowedDetailPageAssetRole("panel-8")).toBe(true);
    expect(isAllowedDetailPageAssetRole("v3-unknown-role")).toBe(false);
  });
});

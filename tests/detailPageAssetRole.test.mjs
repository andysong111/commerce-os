import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedDetailPageAssetRole,
  normalizeDetailPageAssetRole,
} from "../src/lib/detailPageAssetRole.ts";

test("maps representative roles onto the existing main and additional slots", () => {
  assert.equal(normalizeDetailPageAssetRole("v3-representative-main-catalog"), "main");
  assert.equal(
    normalizeDetailPageAssetRole("v3-representative-alternate-whole"),
    "additional-1",
  );
  assert.equal(
    normalizeDetailPageAssetRole("v3-representative-evidence-detail"),
    "additional-2",
  );
  assert.equal(
    normalizeDetailPageAssetRole("v3-representative-lifestyle-usage"),
    "additional-3",
  );
  assert.equal(
    normalizeDetailPageAssetRole("v3-representative-adaptive-support"),
    "additional-4",
  );
});

test("maps v3 detail roles onto the existing panel slots", () => {
  assert.equal(normalizeDetailPageAssetRole("v3-hook"), "panel-1");
  assert.equal(normalizeDetailPageAssetRole("v3-point-1-filler"), "panel-2");
  assert.equal(normalizeDetailPageAssetRole("v3-point-2-filler"), "panel-3");
  assert.equal(normalizeDetailPageAssetRole("v3-point-3-filler"), "panel-4");
  assert.equal(normalizeDetailPageAssetRole("v3-usage-filler-1"), "panel-5");
  assert.equal(normalizeDetailPageAssetRole("v3-usage-filler-2"), "panel-6");
  assert.equal(normalizeDetailPageAssetRole("v3-option-filler"), "panel-7");
});

test("keeps existing storage roles unchanged and rejects unknown roles", () => {
  assert.equal(normalizeDetailPageAssetRole("main"), "main");
  assert.equal(normalizeDetailPageAssetRole("detail-page"), "detail-page");
  assert.equal(isAllowedDetailPageAssetRole("v3-hook"), true);
  assert.equal(isAllowedDetailPageAssetRole("panel-8"), true);
  assert.equal(isAllowedDetailPageAssetRole("v3-unknown-role"), false);
});

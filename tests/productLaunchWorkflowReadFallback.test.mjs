import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../src/app/api/product-launch-tracker/optimized/route.ts", import.meta.url),
  "utf8",
);

test("workspace timeout falls back to the authoritative legacy read before 503", () => {
  assert.match(route, /catch \(error\) \{\s*return degradedLegacyRead\(/s);
  assert.match(route, /mode === "page"\s*\? await legacyPageResponse/s);
  assert.match(route, /mode === "items"\s*\? await legacyItemsResponse/s);
  assert.match(route, /await legacyItemResponse/);
});

test("normalized page timeout also falls back instead of forcing read-only mode", () => {
  assert.match(
    route,
    /queryProductLaunchNormalizedPage[\s\S]*?catch \(error\) \{\s*return degradedLegacyRead\(/,
  );
  assert.match(route, /X-Commerce-OS-Workflow-Fallback/);
});

test("503 is returned only when the legacy fallback also fails", () => {
  assert.match(route, /Product Launch normalized and legacy reads both failed/);
  assert.match(route, /workflowUnavailableResponse\(legacyError, normalizedError\)/);
});

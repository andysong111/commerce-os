import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appPath = fileURLToPath(new URL("../public/product-launch-tracker-app/optimized-app.js", import.meta.url));
const entryPath = fileURLToPath(new URL("../public/product-launch-tracker-app/app.js", import.meta.url));
const routePath = fileURLToPath(new URL("../src/app/api/product-launch-tracker/optimized/route.ts", import.meta.url));
const stateRoutePath = fileURLToPath(new URL("../src/app/api/product-launch-tracker/state/route.ts", import.meta.url));
const dockPath = fileURLToPath(new URL("../public/product-launch-tracker-app/detail-page-dock.js", import.meta.url));
const [app, entry, route, stateRoute, dock] = await Promise.all(
  [appPath, entryPath, routePath, stateRoutePath, dockPath].map((path) =>
    readFile(path, "utf8"),
  ),
);

test("optimized browser modules remain valid JavaScript", () => {
  execFileSync(process.execPath, ["--check", appPath]);
  execFileSync(process.execPath, ["--check", entryPath]);
});

test("tracker loads server-paged optimized app instead of legacy full-list bootstrap", () => {
  assert.match(entry, /await import\("\.\/optimized-app\.js"\)/);
  assert.doesNotMatch(entry, /await import\("\.\/bootstrap\.js"\)/);
  assert.doesNotMatch(entry, /await import\("\.\/inline-save-no-flicker\.js"\)/);
  assert.doesNotMatch(entry, /product-launch-flow-batch-handoff\.js/);
  assert.doesNotMatch(entry, /multi-option-main-barcode-visibility\.js/);
  assert.match(entry, /requestIdleCallback/);
});

test("list, search, and detail follow bounded server requests", () => {
  assert.match(app, /const DEFAULT_PAGE_SIZE = 25/);
  assert.match(app, /const SEARCH_DELAY_MS = 260/);
  assert.match(app, /mode: "page"/);
  assert.match(app, /mode: "item", id: itemId/);
  assert.match(app, /서버가 현재 페이지 데이터만 불러옵니다/);
  assert.doesNotMatch(app, /window\.location\.reload\(\)/);
  assert.match(app, /BATCH_SELECTION_KEY/);
  assert.match(app, /readChinaProductLinkInputs/);
});

test("inline saves are item-scoped and do not replace the full table", () => {
  assert.match(app, /operation: "patch_item"/);
  assert.match(app, /enqueueItemMutation/);
  assert.match(app, /row\.outerHTML = renderRow\(updated\)/);
  const commitStart = app.indexOf("async function commitInlineInput");
  const commitEnd = app.indexOf("async function commitStatusInput", commitStart);
  const commitSource = app.slice(commitStart, commitEnd);
  assert.doesNotMatch(commitSource, /tableBody\.innerHTML/);
});

test("optimized API exposes page, lazy item, export, and PATCH mutations", () => {
  assert.match(route, /mode === "item"/);
  assert.match(route, /mode === "export"/);
  assert.match(route, /queryProductLaunchTrackerPage/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /conditionalWriteState/);
});

test("legacy partial-page writes merge into the canonical full state", () => {
  assert.match(stateRoute, /incoming\.partialPage === true/);
  assert.match(stateRoute, /mergePartialPage\(existing, incoming\)/);
  assert.match(stateRoute, /items: mergedItems/);
  assert.match(stateRoute, /delete merged\.partialPage/);
});


test("optimized table keeps the product detail action aligned with the manage column", () => {
  assert.match(app, /data-column-key="manage"/);
  assert.doesNotMatch(app, /data-column-key="actions"/);
  assert.match(app, /상품 상세/);
});

test("detail-page generation resolves full selected items when local cache is partial", () => {
  assert.match(route, /mode === "items"/);
  assert.match(route, /requestedIds.length > 100/);
  assert.match(dock, /loadAuthoritativeSelectedItems/);
  assert.ok(dock.includes("state?.partialPage !== true"));
  assert.match(dock, /mode: "items"/);
  assert.match(dock, /cache: "no-store"/);
});

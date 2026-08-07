import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, controls, cancelRoute, deleteRoute] = await Promise.all([
  readFile("src/app/detail-page-ai-review/page.tsx", "utf8"),
  readFile(
    "src/components/detail-page-ai-review/DetailPageActiveJobControlsV2.tsx",
    "utf8",
  ),
  readFile(
    "src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/review-cancel/route.ts",
    "utf8",
  ),
  readFile(
    "src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/review-delete/route.ts",
    "utf8",
  ),
]);

test("AI review page exposes active-job controls", () => {
  assert.match(page, /DetailPageActiveJobControlsV2/);
  assert.match(controls, /진행 중 작업 제어/);
  assert.match(controls, /작업 취소/);
  assert.match(controls, /취소 후 삭제/);
  assert.match(controls, /진행 중 전체 취소/);
  assert.match(controls, /전체 취소 후 삭제/);
});

test("review cancellation invalidates in-flight workers and releases leases", () => {
  assert.match(cancelRoute, /status: "cancelled"/);
  assert.match(cancelRoute, /execution_id: randomUUID\(\)/);
  assert.match(cancelRoute, /worker_dispatch_id: ""/);
  assert.match(cancelRoute, /lease_owner: ""/);
  assert.match(cancelRoute, /lease_until: null/);
  assert.match(cancelRoute, /현재 진행 중인 상세페이지 작업만 취소/);
});

test("review deletion requires a cancelled job and leaves product assets untouched", () => {
  assert.match(deleteRoute, /job\.status !== "cancelled"/);
  assert.match(deleteRoute, /method: "DELETE"/);
  assert.match(deleteRoute, /preservedProductAssets: true/);
  assert.doesNotMatch(deleteRoute, /detailPageAsset/);
});

test("UI always cancels before deleting the durable job row", () => {
  assert.match(controls, /review-cancel/);
  assert.match(controls, /if \(!removeAfter\) return/);
  assert.match(controls, /review-delete/);
});

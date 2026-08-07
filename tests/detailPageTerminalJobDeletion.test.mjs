import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, controls, deleteRoute] = await Promise.all([
  readFile("src/app/detail-page-ai-review/page.tsx", "utf8"),
  readFile(
    "src/components/detail-page-ai-review/DetailPageTerminalJobControls.tsx",
    "utf8",
  ),
  readFile(
    "src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/review-delete/route.ts",
    "utf8",
  ),
]);

test("AI review page exposes deletion controls for review-needed and completed jobs", () => {
  assert.match(page, /DetailPageTerminalJobControls/);
  assert.match(controls, /검수 필요 전체 삭제/);
  assert.match(controls, /완료 전체 삭제/);
  assert.match(controls, /개별 삭제 목록/);
  assert.match(controls, /detailPageReviewBucket/);
});

test("terminal job deletion preserves product assets and only accepts stopped jobs", () => {
  assert.match(deleteRoute, /DELETABLE_STATUSES/);
  assert.match(deleteRoute, /"cancelled", "failed", "success"/);
  assert.match(deleteRoute, /진행 중 작업은 먼저 취소한 뒤 삭제/);
  assert.match(deleteRoute, /job\.status === "success" && job\.qa_status !== "passed"/);
  assert.match(deleteRoute, /preservedProductAssets: true/);
  assert.match(deleteRoute, /preservedStorageAssets: true/);
});

test("completed and review deletion warnings disclose checkpoint loss", () => {
  assert.match(controls, /실패 원인·체크포인트/);
  assert.match(controls, /부분 재생성·재검수·최종 재조립/);
  assert.match(controls, /상품상세.*URL\/HTML.*저장 이미지 파일.*유지/);
});

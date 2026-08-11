import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, prompt, requestRoute, startRoute] = await Promise.all([
  readFile("src/app/detail-page-ai-review/page.tsx", "utf8"),
  readFile(
    "src/components/detail-page-ai-review/DetailPageBGradeFallbackQueue.tsx",
    "utf8",
  ),
  readFile(
    "src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/b-grade/route.ts",
    "utf8",
  ),
  readFile(
    "src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/start/route.ts",
    "utf8",
  ),
]);

test("v260807 review page offers B-grade source-only fallback only after generation safety block", () => {
  assert.match(page, /DetailPageBGradeFallbackQueue/);
  assert.match(prompt, /generation_safety_block/);
  assert.match(prompt, /안전검사에서 차단되어 B급 엔진으로 실행하시겠습니까/);
  assert.match(prompt, /AI 이미지를 새로 생성하지 않고 저장된 1688 원본 사진만/);
  assert.match(prompt, /B급 원본 조립으로 실행/);
});

test("B-grade request stays job-scoped and preserves the existing A-grade engine", () => {
  assert.match(requestRoute, /v260807ManualDecisionKind/);
  assert.match(requestRoute, /DETAIL_PAGE_B_GRADE_NOT_ALLOWED/);
  assert.match(requestRoute, /v3_b_grade_source_only: true/);
  assert.match(requestRoute, /source-only-b-grade-v1/);
  assert.match(requestRoute, /qualityTier: "B"/);
  assert.match(requestRoute, /manual_review_decision: "run_b_grade_source_only"/);
});

test("start route sends only explicit B-grade jobs to the dedicated Studio query", () => {
  assert.match(startRoute, /B_GRADE_ACTION = "b_grade_source_only"/);
  assert.match(startRoute, /B_GRADE_PARAMETER = "b_grade_source_only"/);
  assert.match(startRoute, /job\.payload\.v3_b_grade_source_only === true/);
  assert.match(startRoute, /workerUrl\.searchParams\.set\(B_GRADE_PARAMETER, "1"\)/);
  assert.match(startRoute, /source-first-v3/);
});

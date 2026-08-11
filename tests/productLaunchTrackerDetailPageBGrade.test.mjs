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

test("v260807 review page offers B-grade fallback, retry, completed B-grade rerun, and completed A-grade conversion", () => {
  assert.match(page, /DetailPageBGradeFallbackQueue/);
  assert.match(prompt, /generation_safety_block/);
  assert.match(prompt, /B_GRADE_SOURCE_ONLY_FAILED/);
  assert.match(prompt, /B_GRADE_HYBRID_FAILED/);
  assert.match(prompt, /DETAIL_PAGE_STEP_OUTCOME_UNKNOWN/);
  assert.match(prompt, /v3_b_grade_source_only_assembly/);
  assert.match(prompt, /B급 엔진으로 실행/);
  assert.match(prompt, /B급 엔진 다시 실행/);
  assert.match(prompt, /B급으로 재생성/);
  assert.match(prompt, /rerun_completed_b_grade/);
  assert.match(prompt, /rerun_completed_as_b_grade/);
  assert.match(prompt, /일반 엔진 검수 통과 완료 작업/);
  assert.match(prompt, /isCompletedAGradeEligible/);
  assert.match(prompt, /v260807SourceAnchorSnapshot/);
});

test("completed rerun recognizes historical B-grade results and ordinary v260807 A-grade results", () => {
  assert.match(prompt, /source-only-b-grade-v1/);
  assert.match(prompt, /b-grade-hybrid-v2/);
  assert.match(prompt, /bGradeSourceOnly === true/);
  assert.match(prompt, /seller-source-only-no-ai-generation/);
  assert.match(prompt, /isV260807DetailPageJob/);
  assert.match(requestRoute, /source-only-b-grade-v1/);
  assert.match(requestRoute, /b-grade-hybrid-v2/);
  assert.match(requestRoute, /isCompletedAGradeEligible/);
  assert.match(requestRoute, /isV260807DetailPageJob/);
  assert.match(requestRoute, /v260807SourceAnchorSnapshot/);
});

test("completed A-grade conversion preserves the current successful artifacts until B-grade succeeds", () => {
  assert.match(requestRoute, /COMPLETED_A_GRADE_TO_B_GRADE_ACTION = "rerun_completed_as_b_grade"/);
  assert.match(requestRoute, /completedAGradeConversion/);
  assert.match(requestRoute, /rerun_completed_a_grade_as_b_grade/);
  assert.match(requestRoute, /completed_a_grade_to_b_grade/);
  assert.match(requestRoute, /기존 A급 검수 통과 결과 보존/);
  assert.match(requestRoute, /completedResultBackup/);
  assert.match(requestRoute, /bGradeRerunBackup/);
  assert.match(requestRoute, /detailImageUrl/);
  assert.match(requestRoute, /mainImageUrl/);
  assert.match(requestRoute, /additionalImageUrls/);
  assert.match(requestRoute, /source-first-v3/);
});

test("B-grade request route accepts the unknown-outcome stop from B-grade assembly", () => {
  assert.match(requestRoute, /DETAIL_PAGE_STEP_OUTCOME_UNKNOWN/);
  assert.match(requestRoute, /v3_b_grade_source_only_assembly/);
  assert.match(requestRoute, /isBGradeFailed/);
  assert.match(requestRoute, /retry_b_grade_source_only/);
});

test("new B-grade requests keep the source-only detail contract", () => {
  assert.match(requestRoute, /v260807ManualDecisionKind/);
  assert.match(requestRoute, /DETAIL_PAGE_B_GRADE_NOT_ALLOWED/);
  assert.match(requestRoute, /isBGradeFailed/);
  assert.match(requestRoute, /isCompletedBGrade/);
  assert.match(requestRoute, /B_GRADE_SOURCE_ONLY_FAILED/);
  assert.match(requestRoute, /B_GRADE_HYBRID_FAILED/);
  assert.match(requestRoute, /v3_b_grade_source_only: true/);
  assert.match(requestRoute, /id: "source-only-b-grade-v1"/);
  assert.match(requestRoute, /sourceOnly: true/);
  assert.match(requestRoute, /aiImageGeneration: false/);
  assert.match(requestRoute, /run_b_grade_source_only/);
  assert.match(requestRoute, /rerun_completed_b_grade_source_only/);
  assert.match(requestRoute, /rerun_completed_a_grade_as_b_grade/);
});

test("completed B-grade rerun preserves the previous successful artifact snapshot until replacement succeeds", () => {
  assert.match(requestRoute, /COMPLETED_B_GRADE_RERUN_ACTION = "rerun_completed_b_grade"/);
  assert.match(requestRoute, /completedBGradeRerun/);
  assert.match(requestRoute, /bGradeRerunBackup/);
  assert.match(requestRoute, /detailImageUrl/);
  assert.match(requestRoute, /mainImageUrl/);
  assert.match(requestRoute, /additionalImageUrls/);
  assert.match(requestRoute, /completed_b_grade_rerun/);
  assert.match(requestRoute, /progress: completedRerun/);
});

test("start route keeps the dedicated B-grade routing flag separate from normal source-first-v3", () => {
  assert.match(startRoute, /B_GRADE_ACTION = "b_grade_source_only"/);
  assert.match(startRoute, /B_GRADE_PARAMETER = "b_grade_source_only"/);
  assert.match(startRoute, /job\.payload\.v3_b_grade_source_only === true/);
  assert.match(startRoute, /workerUrl\.searchParams\.set\(B_GRADE_PARAMETER, "1"\)/);
  assert.match(startRoute, /source-first-v3/);
});

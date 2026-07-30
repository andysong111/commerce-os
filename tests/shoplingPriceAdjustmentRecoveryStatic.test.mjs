import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orchestrator = readFileSync("src/lib/shoplingPriceAdjustmentBulkOrchestrator.ts", "utf8");
const route = readFileSync("src/app/api/shopling-price-adjustment/bulk/jobs/[jobId]/recover-partial-plan/route.ts", "utf8");
const panel = readFileSync("src/components/shopling-price-adjustment/ShoplingPriceAdjustmentPartialRecoveryPanel.tsx", "utf8");
const page = readFileSync("src/app/shopling-price-adjustment-runner/page.tsx", "utf8");

test("partial read-only failures exclude bad rows without repeating successful goods", () => {
  assert.match(orchestrator, /buildPartialExecutionPlan/);
  assert.match(orchestrator, /조회 오류 상품 자동 제외/);
  assert.match(orchestrator, /input_rows: plan\.validInputs/);
  assert.match(orchestrator, /status: "not_executed"/);
});

test("recovery route only resets failed read-only plan jobs", () => {
  assert.match(route, /PARTIAL_FAILURE_PATTERN/);
  assert.match(route, /execute_request_id/);
  assert.match(route, /실제 가격 변경이 시작된 청크는 자동 복구하지 않습니다/);
  assert.match(route, /\.eq\("status", "not_executed"\)/);
  assert.match(route, /status: "running"/);
});

test("runner page exposes a one-click recovery card", () => {
  assert.match(panel, /오류 상품 제외 후 이어서 실행 준비/);
  assert.match(panel, /recover-partial-plan/);
  assert.match(page, /ShoplingPriceAdjustmentPartialRecoveryPanel/);
});

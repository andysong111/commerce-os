import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL(
    "../src/app/api/product-launch-tracker/migrations/complete-stock-sheet-backfill-stages-20260812/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const workflow = await readFile(
  new URL(
    "../.github/workflows/product-launch-complete-stock-sheet-stages-20260812.yml",
    import.meta.url,
  ),
  "utf8",
);

test("방금 추가한 284개 등록완료건만 상태 변경 대상으로 고정한다", () => {
  assert.match(route, /const SOURCE_IMPORT = "stock-sheet-backfill-20260812";/);
  assert.match(route, /const WORK_BATCH = "등록완료건";/);
  assert.match(route, /const EXPECTED_TARGET_COUNT = 284;/);
  assert.match(route, /text\(source\.import\) === SOURCE_IMPORT/);
  assert.match(route, /text\(item\.workBatch\) === WORK_BATCH/);
  assert.match(route, /BACKFILL_TARGET_COUNT_MISMATCH/);
});

test("요청된 세 단계만 완료 처리한다", () => {
  assert.match(
    route,
    /const STAGE_KEYS = \["detailPage", "shoplingUpload", "marketRegistration"\] as const;/,
  );
  assert.match(route, /operation: "bulk_stage"/);
  assert.match(route, /status: "완료"/);
  assert.doesNotMatch(route, /"priceKeyword"/);
  assert.doesNotMatch(route, /"orderMapping"/);
  assert.doesNotMatch(route, /"inventoryReflection"/);
});

test("운영 워크플로가 dry-run, 실제 적용, 중복 방지 검증을 순서대로 수행한다", () => {
  const dryRun = workflow.indexOf("Wait for production migration endpoint");
  const apply = workflow.indexOf("Apply completion exactly once");
  const verify = workflow.indexOf("Verify idempotency");
  assert.ok(dryRun >= 0);
  assert.ok(apply > dryRun);
  assert.ok(verify > apply);
  assert.match(workflow, /targetCount !== 284/);
  assert.match(workflow, /alreadyApplied !== true/);
});

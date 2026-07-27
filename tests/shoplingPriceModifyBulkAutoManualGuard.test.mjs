import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const guardedRoutes = [
  "src/app/api/shopling-price-modify/bulk/jobs/[jobId]/canary/dispatch/route.ts",
  "src/app/api/shopling-price-modify/bulk/jobs/[jobId]/canary/result/route.ts",
  "src/app/api/shopling-price-modify/bulk/jobs/[jobId]/normal/approve/route.ts",
  "src/app/api/shopling-price-modify/bulk/jobs/[jobId]/normal/advance/route.ts",
  "src/app/api/shopling-price-modify/bulk/jobs/[jobId]/normal/result/route.ts",
  "src/app/api/shopling-price-modify/bulk/jobs/[jobId]/retry/advance/route.ts",
  "src/app/api/shopling-price-modify/bulk/jobs/[jobId]/retry/result/route.ts",
];

test("manual progression routes reject auto-managed jobs before reserve or result writes", async () => {
  const helper = await read("src/lib/shoplingPriceModifyBulkApi.ts");
  assert.match(helper, /function requireManualShoplingPriceBulkJob/);
  assert.match(helper, /select\("id,status,automation_mode"\)/);
  assert.match(helper, /result\.data\.automation_mode === "auto"/);
  assert.match(helper, /AUTO_MANAGED_JOB/);

  for (const path of guardedRoutes) {
    const route = await read(path);
    assert.match(route, /requireManualShoplingPriceBulkJob/);
    const guardCall = route.lastIndexOf("requireManualShoplingPriceBulkJob(");
    const progressionPositions = ["reserve_", "finish_", "dispatchShoplingPriceBulk", "fetchShoplingPriceModifyActionsResult"]
      .map((needle) => route.lastIndexOf(needle))
      .filter((position) => position > guardCall);
    assert.ok(guardCall >= 0, `${path} is missing the manual guard call`);
    assert.ok(progressionPositions.length > 0, `${path} has no progression call to protect`);
    assert.ok(Math.min(...progressionPositions) > guardCall, `${path} performs progression before the manual guard`);
    assert.match(route.slice(guardCall), /manual\.response\)\s*return manual\.response/);
  }
});

test("explicit pause, resume and failed-item approval remain available for auto jobs", async () => {
  const [retryApprove, pause, resume] = await Promise.all([
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/retry/approve/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/control/pause/route.ts"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/control/resume/route.ts"),
  ]);
  for (const route of [retryApprove, pause, resume]) assert.doesNotMatch(route, /requireManualShoplingPriceBulkJob/);
  assert.match(retryApprove, /CONFIRM_FAILED_GOODS_RETRY/);
  assert.match(pause, /CONFIRM_BULK_PAUSE/);
  assert.match(resume, /CONFIRM_BULK_RESUME/);
});

test("advanced UI gives server automation exclusive progression ownership", async () => {
  const ui = await read("src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkInputPreview.tsx");
  assert.match(ui, /automation_mode\?: string/);
  assert.match(ui, /const autoManaged = detail\?\.job\.automation_mode === "auto"/);
  assert.match(ui, /if \(!detail \|\| detail\.job\.automation_mode === "auto"\) return/);
  assert.match(ui, /if \(job\.job\.automation_mode === "auto"\) return/);
  assert.match(ui, /!autoManaged && detail\.job\.status === "prepared"/);
  assert.match(ui, /!autoManaged && detail\.job\.status === "canary_succeeded"/);
  assert.match(ui, /현재 청크 후 일시중지, 직렬 실행 재개, 실패 상품 제한 재실행은 계속 사용할 수 있습니다/);
});

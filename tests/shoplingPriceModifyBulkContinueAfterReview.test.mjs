import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("explicit auto continuation is production-only, owner-scoped, and active-chunk gated", async () => {
  const route = await read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/control/continue-auto/route.ts");

  assert.match(route, /process\.env\.VERCEL_ENV !== "production"/);
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /CONFIRM_AUTO_CONTINUE_AFTER_REVIEW/);
  assert.match(route, /normalSession\(\)/);
  assert.match(route, /eq\("owner_id", auth\.ownerId\)/);
  assert.match(route, /automation_mode !== "auto"/);
  assert.match(route, /automation_stop_reason/);
  assert.match(route, /ACTIVE_CHUNK_STATUSES/);
  assert.match(route, /ACTIVE_CHUNK_EXISTS/);
  assert.match(route, /resume_shopling_price_bulk_auto_execution/);
  assert.doesNotMatch(route, /dispatchShoplingPriceBulk|generateShoplingPriceModifyRequestId|workflow_dispatch/);
});

test("paused stopped jobs are made resumable before the auto stop marker is cleared", async () => {
  const route = await read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/control/continue-auto/route.ts");
  const pausedResume = route.indexOf('rpc("resume_shopling_price_bulk_execution"');
  const autoResume = route.indexOf('rpc("resume_shopling_price_bulk_auto_execution"');

  assert.match(route, /\["normal_paused", "retry_paused"\]\.includes\(status\)/);
  assert.ok(pausedResume >= 0 && autoResume > pausedResume);
  assert.match(route, /같은 버튼을 다시 눌러도 이미 성공한 상품은 재실행되지 않습니다/);
});

test("simple UI keeps polling only the existing uncertain request and requires a visible user confirmation to continue", async () => {
  const ui = await read("src/components/shopling-price-modify-runner/ShoplingPriceModifySimpleAutoRunner.tsx");

  assert.match(ui, /current_active_chunk\?: Chunk \| null/);
  assert.match(ui, /detail\.job\.automation_stop_reason && !hasActiveChunk\(detail\)/);
  assert.match(ui, /현재 요청의 결과만 확인하고 있습니다/);
  assert.match(ui, /CONTINUABLE_STOPPED_STATUSES/);
  assert.match(ui, /CONFIRM_AUTO_CONTINUE_AFTER_REVIEW/);
  assert.match(ui, /확인 후 계속 실행/);
  assert.match(ui, /이미 성공한 상품은 다시 실행하지 않습니다/);
  assert.match(ui, /!detail\.job\.automation_stop_reason[\s\S]*?normal_running[\s\S]*?retry_running/);
  assert.match(ui, /!detail\.job\.automation_stop_reason[\s\S]*?normal_paused[\s\S]*?retry_paused/);
});

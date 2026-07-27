import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("006 migration adds auto mode, bounded leases, explicit stop and resume contracts", async () => {
  const sql = await read("supabase/migrations/202607280002_shopling_price_bulk_one_click_auto.sql");
  for (const phrase of [
    "automation_mode text not null default 'manual'",
    "automation_started_at",
    "automation_last_tick_at",
    "automation_finished_at",
    "automation_lease_until",
    "automation_worker_id",
    "automation_stop_reason",
    "enable_shopling_price_bulk_auto_execution",
    "claim_next_shopling_price_bulk_auto_job",
    "release_shopling_price_bulk_auto_job",
    "finish_shopling_price_bulk_auto_job",
    "stop_shopling_price_bulk_auto_job",
    "resume_shopling_price_bulk_auto_execution",
    "for update skip locked",
    "service_role",
  ]) assert.match(sql.toLowerCase(), new RegExp(phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(sql, /execution_mode\s*<>\s*'validation_only'/);
  assert.match(sql, /job\.archived_at is null/);
  assert.match(sql, /job\.automation_stop_reason is null/);
  assert.match(sql, /automation_lease_until is null or job\.automation_lease_until <= now\(\)/);
  assert.match(sql, /p_lease_seconds < 15 or p_lease_seconds > 120/);
  assert.match(sql, /status in \([\s\S]*?'prepared'[\s\S]*?'canary_running'[\s\S]*?'normal_running'[\s\S]*?'dispatch_uncertain'/);
  assert.doesNotMatch(sql, /status in \([\s\S]*?'normal_succeeded'[\s\S]*?for update skip locked/);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.shopling_price_bulk_/i);
});

test("default operator screen is simple and the technical tools remain on the advanced route", async () => {
  const [page, simple, advanced] = await Promise.all([
    read("src/app/shopling-price-modify-runner/page.tsx"),
    read("src/components/shopling-price-modify-runner/ShoplingPriceModifySimpleAutoRunner.tsx"),
    read("src/app/shopling-price-modify-runner/advanced/page.tsx"),
  ]);

  assert.match(page, /ShoplingPriceModifySimpleAutoRunner/);
  assert.doesNotMatch(page, /ShoplingPriceModifyBulkInputPreview|ShoplingPriceModifyBulkOperations/);
  assert.doesNotMatch(page, /from "@\/components\/shopling-price-modify-runner\/ShoplingPriceModifyRunner"|<ShoplingPriceModifyRunner\s*\/>/);
  assert.equal((simple.match(/전체 가격 자동 변경 시작/g) ?? []).length, 1);
  for (const phrase of [
    "상품번호 넣기",
    "쉼표, 공백, 줄바꿈이 섞여 있어도 자동으로 구분합니다.",
    "변경할 상품",
    "제외된 중복",
    "잘못된 번호",
    "실행 묶음",
    "1. 입력 확인",
    "2. 첫 10개 시험",
    "3. 나머지 자동 실행",
    "4. 완료",
    "현재 묶음 후 멈추기",
    "계속 실행",
    "실패 상품만 다시 실행",
    "결과 파일 받기",
    "고급 관리 열기",
  ]) assert.match(simple, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(simple, /\/shopling-price-modify-runner\/advanced/);
  assert.doesNotMatch(simple, /setInterval/);

  for (const component of [
    "ShoplingPriceModifyBulkInputPreview",
    "ShoplingPriceModifyBulkOperations",
    "ShoplingPriceModifyRunner",
  ]) assert.match(advanced, new RegExp(component));
});

test("one-click creation API is session-owned, confirmation-gated, and starts only the first safe step", async () => {
  const route = await read("src/app/api/shopling-price-modify/bulk/auto-jobs/route.ts");
  assert.match(route, /normalSession\(\)/);
  assert.match(route, /CONFIRM_ONE_CLICK_AUTO_PRICE_CHANGE/);
  assert.match(route, /validateShoplingPriceBulkCreateInput/);
  assert.match(route, /create_shopling_price_bulk_prepared_job/);
  assert.match(route, /p_owner_id: auth\.ownerId/);
  assert.match(route, /enable_shopling_price_bulk_auto_execution/);
  assert.match(route, /maxTransitions: 1/);
  assert.match(route, /releaseShoplingPriceBulkAutoJob/);
  assert.doesNotMatch(route, /approve_shopling_price_bulk_failed_retry/);
});

test("cron is production GET, exact Bearer authenticated, fail-closed, and bounded", async () => {
  const [route, vercel] = await Promise.all([
    read("src/app/api/cron/shopling-price-bulk-auto/route.ts"),
    read("vercel.json"),
  ]);
  assert.match(route, /export async function GET/);
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /if \(!secret\)/);
  assert.match(route, /Authorization|authorization/);
  assert.match(route, /Bearer \$\{secret\}/);
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /MAX_JOBS = 5/);
  assert.match(route, /MAX_TRANSITIONS = 4/);
  assert.match(route, /LEASE_SECONDS = 75/);
  assert.doesNotMatch(route, /user-agent/i);
  assert.doesNotMatch(route, /createSupabaseServerClient|auth\.getUser/);
  const config = JSON.parse(vercel);
  assert.deepEqual(config.crons, [{ path: "/api/cron/shopling-price-bulk-auto", schedule: "* * * * *" }]);
});

test("orchestrator uses existing request IDs, serial result checks, and never auto-approves failed-item retry", async () => {
  const source = await read("src/lib/shoplingPriceModifyBulkAutoOrchestrator.ts");
  assert.match(source, /generateShoplingPriceModifyRequestId/);
  assert.match(source, /fetchShoplingPriceModifyActionsResult\(requestId\)/);
  assert.match(source, /analyzeShoplingPriceBulkCanaryResult/);
  assert.match(source, /analyzeShoplingPriceBulkNormalResult/);
  assert.match(source, /reserve_shopling_price_bulk_canary/);
  assert.match(source, /approve_shopling_price_bulk_normal_execution/);
  assert.match(source, /reserve_next_shopling_price_bulk_normal_chunk/);
  assert.match(source, /finish_shopling_price_bulk_normal_chunk/);
  assert.match(source, /dispatch_uncertain/);
  assert.match(source, /loadActiveChunks/);
  assert.doesNotMatch(source, /approve_shopling_price_bulk_failed_retry/);
  assert.doesNotMatch(source, /setInterval|setTimeout/);
});

test("explicit failed-item retry reconnects auto mode but leaves manual jobs unchanged", async () => {
  const [route, sql] = await Promise.all([
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/retry/approve/route.ts"),
    read("supabase/migrations/202607280002_shopling_price_bulk_one_click_auto.sql"),
  ]);
  assert.match(route, /approve_shopling_price_bulk_failed_retry/);
  assert.match(route, /resume_shopling_price_bulk_auto_execution/);
  assert.match(route, /auto_resumed/);
  assert.match(sql, /if v_job\.automation_mode = 'manual' then[\s\S]*?'auto', false/);
  assert.match(sql, /status not in \('retry_running','normal_running','canary_succeeded'\)/);
  assert.match(sql, /automation_stop_reason = null/);
});

test("detail API exposes auto state while validation-only remains structurally excluded", async () => {
  const route = await read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/route.ts");
  for (const field of [
    "automation_mode",
    "automation_started_at",
    "automation_last_tick_at",
    "automation_finished_at",
    "automation_lease_until",
    "automation_worker_id",
    "automation_stop_reason",
  ]) assert.match(route, new RegExp(field));
  const migration = await read("supabase/migrations/202607280002_shopling_price_bulk_one_click_auto.sql");
  assert.match(migration, /execution_mode = 'live'/);
  assert.match(migration, /execution_mode <> 'validation_only' or automation_mode = 'manual'/);
});

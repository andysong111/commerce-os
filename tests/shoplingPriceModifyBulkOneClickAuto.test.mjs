import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("006 migration adds bounded leases and recoverable unattended claims", async () => {
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
    "approve_shopling_price_bulk_failed_retry_auto",
    "for update skip locked",
    "service_role",
  ]) assert.match(sql.toLowerCase(), new RegExp(phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(sql, /execution_mode\s*<>\s*'validation_only'/);
  assert.match(sql, /job\.archived_at is null/);
  assert.match(sql, /'normal_succeeded'/);
  assert.match(sql, /job\.automation_stop_reason is null[\s\S]*?or exists \([\s\S]*?active_chunk\.status in \('dispatching','running','dispatch_uncertain'\)/);
  assert.match(sql, /not job\.pause_requested[\s\S]*?or job\.status in \('normal_running','retry_running','dispatch_uncertain'\)/);
  assert.match(sql, /automation_lease_until is null or job\.automation_lease_until <= now\(\)/);
  assert.match(sql, /p_lease_seconds < 15 or p_lease_seconds > 120/);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.shopling_price_bulk_/i);
});

test("default operator screen is simple, clears stale input, and locks every unfinished auto job", async () => {
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
  assert.match(simple, /const onFile[\s\S]*?setSelection\(null\)[\s\S]*?parseShoplingPriceBulkFile/);
  assert.match(simple, /const onPaste[\s\S]*?setSelection\(null\)[\s\S]*?parseShoplingPriceBulkPaste/);
  assert.match(simple, /function isUnfinishedAutoJob[\s\S]*?automation_finished_at[\s\S]*?archived_at/);
  assert.match(simple, /disabled=\{busy \|\| preview\.validCount === 0 \|\| unfinishedAutoExists\}/);
  assert.match(simple, /고급 관리에서 보관한 뒤 새 작업을 시작/);
  assert.doesNotMatch(simple, /setInterval/);

  for (const component of [
    "ShoplingPriceModifyBulkInputPreview",
    "ShoplingPriceModifyBulkOperations",
    "ShoplingPriceModifyRunner",
  ]) assert.match(advanced, new RegExp(component));
});

test("one-click creation API is Production-only, session-owned, confirmation-gated, and starts one safe step", async () => {
  const route = await read("src/app/api/shopling-price-modify/bulk/auto-jobs/route.ts");
  assert.match(route, /process\.env\.VERCEL_ENV !== "production"/);
  assert.match(route, /AUTO_PRODUCTION_ONLY/);
  assert.match(route, /normalSession\(\)/);
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /CONFIRM_ONE_CLICK_AUTO_PRICE_CHANGE/);
  assert.match(route, /validateShoplingPriceBulkCreateInput/);
  assert.match(route, /create_shopling_price_bulk_prepared_job/);
  assert.match(route, /p_owner_id: auth\.ownerId/);
  assert.match(route, /enable_shopling_price_bulk_auto_execution/);
  assert.match(route, /maxTransitions: 1/);
  assert.match(route, /releaseShoplingPriceBulkAutoJob/);
  assert.doesNotMatch(route, /approve_shopling_price_bulk_failed_retry/);
});

test("cron is production GET, exact Bearer authenticated, fail-closed, bounded, and recovery-staggered", async () => {
  const [route, vercel] = await Promise.all([
    read("src/app/api/cron/shopling-price-bulk-auto/route.ts"),
    read("vercel.json"),
  ]);
  assert.match(route, /export async function GET/);
  assert.match(route, /process\.env\.VERCEL_ENV !== "production"/);
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
  assert.ok(Array.isArray(config.crons));
  const target = config.crons.filter(
    (cron) => cron?.path === "/api/cron/shopling-price-bulk-auto",
  );
  assert.deepEqual(target, [
    {
      path: "/api/cron/shopling-price-bulk-auto",
      schedule: "5,20,35,50 * * * *",
    },
  ]);
  const minutes = target[0].schedule.split(" ")[0].split(",").map(Number);
  assert.deepEqual(minutes, [5, 20, 35, 50]);
  const paths = config.crons.map((cron) => cron?.path).filter(Boolean);
  assert.equal(new Set(paths).size, paths.length, "cron paths must stay unique");
});

test("orchestrator reconciles same request IDs, honors pause, and never auto-approves failed-item retry", async () => {
  const source = await read("src/lib/shoplingPriceModifyBulkAutoOrchestrator.ts");
  assert.match(source, /fetchShoplingPriceModifyActionsResult\(requestId\)/);
  assert.match(source, /analyzeShoplingPriceBulkCanaryResult/);
  assert.match(source, /analyzeShoplingPriceBulkNormalResult/);
  assert.match(source, /reserve_shopling_price_bulk_canary/);
  assert.match(source, /approve_shopling_price_bulk_normal_execution/);
  assert.match(source, /reserve_next_shopling_price_bulk_normal_chunk/);
  assert.match(source, /finish_shopling_price_bulk_normal_chunk/);
  assert.match(source, /resultPersistencePending/);
  assert.match(source, /state\.status === "normal_paused"/);
  assert.match(source, /\["normal_paused", "retry_paused"\]/);
  assert.match(source, /if \(stopped\)[\s\S]*?return \{ outcome: "noop"/);
  assert.doesNotMatch(source, /if \(job\.pause_requested \|\|/);
  assert.doesNotMatch(source, /approve_shopling_price_bulk_failed_retry/);
  assert.doesNotMatch(source, /setInterval|setTimeout/);
});

test("explicit failed-item retry approval and auto reconnection are one database transaction", async () => {
  const [route, sql] = await Promise.all([
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/retry/approve/route.ts"),
    read("supabase/migrations/202607280002_shopling_price_bulk_one_click_auto.sql"),
  ]);
  assert.match(route, /approve_shopling_price_bulk_failed_retry_auto/);
  assert.doesNotMatch(route, /resume_shopling_price_bulk_auto_execution/);
  assert.doesNotMatch(route, /rpc\("approve_shopling_price_bulk_failed_retry"/);
  assert.match(sql, /create or replace function public\.approve_shopling_price_bulk_failed_retry_auto/);
  assert.match(sql, /v_result := public\.approve_shopling_price_bulk_failed_retry\(p_job_id, p_owner_id\)/);
  assert.match(sql, /if v_auto then[\s\S]*?automation_stop_reason = null[\s\S]*?automation_worker_id = null/);
  assert.match(sql, /'auto_resumed', v_auto/);
});

test("stopped or paused unattended jobs can be archived only when no active chunk exists", async () => {
  const [sql, report, ui] = await Promise.all([
    read("supabase/migrations/202607280002_shopling_price_bulk_one_click_auto.sql"),
    read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/report/route.ts"),
    read("src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkOperations.tsx"),
  ]);
  assert.match(sql, /create or replace function public\.archive_shopling_price_bulk_job/);
  assert.match(sql, /status in \('dispatching','running','dispatch_uncertain'\)[\s\S]*?raise exception 'active chunk exists'/);
  assert.match(sql, /v_stopped_auto/);
  assert.match(sql, /v_paused_auto/);
  assert.match(report, /automation_mode,automation_started_at,automation_last_tick_at,automation_finished_at,automation_lease_until,automation_stop_reason/);
  assert.match(ui, /const activeChunk/);
  assert.match(ui, /const stoppedAuto/);
  assert.match(ui, /const pausedAuto/);
  assert.match(ui, /&& !activeChunk/);
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
  assert.match(migration, /job\.execution_mode = 'live'/);
  assert.match(migration, /execution_mode <> 'validation_only' or automation_mode = 'manual'/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Supabase SEO RUN 원장은 RLS·명시적 service_role grant·SKIP LOCKED lease를 사용한다", async () => {
  const base = await source(
    "supabase/migrations/202608280001_seo_run_durable_jobs.sql",
  );
  const serial = await source(
    "supabase/migrations/202608280002_seo_run_same_item_serial_claim.sql",
  );
  assert.match(base, /create table if not exists public\.seo_run_jobs/);
  assert.match(base, /checkpoint_payload jsonb/);
  assert.match(base, /result_payload jsonb/);
  assert.match(base, /enable row level security/);
  assert.match(base, /revoke all on table public\.seo_run_jobs from public, anon, authenticated/);
  assert.match(base, /grant select, insert, update, delete on table public\.seo_run_jobs to service_role/);
  assert.match(base, /for update skip locked/);
  assert.match(base, /request\.jwt\.claim\.role/);
  assert.match(serial, /active\.launch_item_id = job\.launch_item_id/);
  assert.match(serial, /active\.lease_until > now\(\)/);
});

test("SEO RUN API는 브라우저 localStorage 회차를 서버 원장에 넣고 after worker를 시작한다", async () => {
  const route = await source("src/app/api/seo-run-jobs/route.ts");
  assert.match(route, /requireSeoTitleLedgerContext/);
  assert.match(route, /readProductLaunchNormalizedItems/);
  assert.match(route, /insertSeoRunJobs/);
  assert.match(route, /action === "enqueue"/);
  assert.match(route, /after\(async \(\) =>/);
  assert.match(route, /processSeoRunQueue/);
  assert.match(route, /variationSeed: run\.runId/);
  assert.match(route, /excludedMallTitles/);
  assert.match(route, /action === "retry"/);
  assert.match(route, /action === "archive"/);
});

test("Vercel worker는 STEP별 체크포인트를 저장하고 마지막 성공 단계에서 이어간다", async () => {
  const worker = await source("src/lib/seoRunWorker.ts");
  for (const stage of [
    "collect_source",
    "analyze_identity",
    "discover_keywords",
    "score_keywords",
    "expand_keywords",
    "filter_keywords",
    "generate_title",
    "compose_final",
    "completed",
  ]) {
    assert.match(worker, new RegExp(stage));
  }
  assert.match(worker, /claimNextSeoRunJob/);
  assert.match(worker, /patchClaimedSeoRunJob/);
  assert.match(worker, /checkpoint_payload/);
  assert.match(worker, /status: "queued"/);
  assert.match(worker, /다음 서버 실행에서 이어갑니다/);
  assert.match(worker, /status: "ready"/);
  assert.match(worker, /result_payload: result/);
  assert.match(worker, /collectKeywordElonBulkSource/);
  assert.match(worker, /composeKeywordElonBulkFinal/);
});

test("Vercel cron이 매분 durable SEO worker를 실행하고 CRON_SECRET으로 보호한다", async () => {
  const cron = await source("src/app/api/cron/seo-run-worker/route.ts");
  const vercel = JSON.parse(await source("vercel.json"));
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /timingSafeEqual/);
  assert.match(cron, /maxDuration = 300/);
  assert.match(cron, /processSeoRunQueue/);
  const entry = vercel.crons.find(
    (row) => row.path === "/api/cron/seo-run-worker",
  );
  assert.deepEqual(entry, {
    path: "/api/cron/seo-run-worker",
    schedule: "* * * * *",
  });
});

test("SEO 클라우드는 서버 원장을 polling하고 인계 완료 후 localStorage 실행본을 제거한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const client = await source(
    "src/app/seo-bulk-cloud/SeoBulkDurableRunCloudClient.tsx",
  );
  assert.match(page, /SeoBulkDurableRunCloudClient/);
  assert.match(client, /\/api\/seo-run-jobs/);
  assert.match(client, /action: "enqueue"/);
  assert.match(client, /window\.localStorage\.removeItem\(BATCH_STORAGE_KEY\)/);
  assert.match(client, /POLL_INTERVAL_MS = 4_000/);
  assert.match(client, /컴퓨터를 꺼도/);
  assert.match(client, /저장된 서버 체크포인트/);
  assert.match(client, /Shopling 일괄 대량등록/);
  assert.match(client, /registration_job_id/);
});

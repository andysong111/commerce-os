import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("기존 adaptive SEO cron은 Shopling 등록큐를 먼저 소화하고 남은 시간으로 SEO 생성을 이어간다", async () => {
  const source = await read("src/app/api/cron/seo-run-worker/route.ts");
  const shopling = source.indexOf("runCoalescedSeoRunShoplingWorkerPulse");
  const seo = source.indexOf("runCoalescedSeoRunWorkerPulse", shopling + 1);
  assert.ok(shopling >= 0);
  assert.ok(seo > shopling);
  assert.match(source, /SAFE_INVOCATION_BUDGET_MS = 275_000/);
  assert.match(source, /remainingMs/);
  assert.match(source, /deferredSeo: true/);
  assert.match(source, /shoplingWorker/);
  assert.match(source, /queuedCount: Math\.max\(result\.queuedCount, shoplingBusy \? 1 : 0\)/);
});

test("Shopling 일괄등록 버튼은 상태만 queued로 바꾸지 않고 즉시 worker와 다음 dispatcher를 깨운다", async () => {
  const source = await read("src/app/api/seo-run-jobs/route.ts");
  assert.match(source, /action === "queue_registration"/);
  assert.match(source, /scheduleShoplingRegistrationWorker/);
  assert.match(source, /runCoalescedSeoRunShoplingWorkerPulse/);
  assert.match(source, /wakeOpsDispatchTask\("seo-run-worker", 0\)/);
  assert.match(source, /이미 서버 등록큐에 있습니다\. worker를 다시 깨웠습니다/);
  assert.match(source, /서버 Shopling 등록큐에 넣고 worker를 시작했습니다/);
});

test("공유 Shopling pulse work는 등록, 진실값 대조, 재시도 준비, 후처리를 순서대로 수행한다", async () => {
  const source = await read("src/lib/seoRunShoplingPulseWork.ts");
  const implementation = source.slice(
    source.indexOf("export async function runSeoRunShoplingPulseWork"),
  );
  const queue = implementation.indexOf(
    "processSeoRunShoplingRegistrationQueue",
  );
  const truth = implementation.indexOf(
    "reconcileVerifiedShoplingRegistrations",
  );
  const rearm = implementation.indexOf(
    "rearmFailedDurableSeoRegistrationRuns",
  );
  const postprocess = implementation.indexOf(
    "processProductLaunchShoplingPostprocessQueue",
  );
  assert.ok(queue >= 0);
  assert.ok(truth > queue);
  assert.ok(rearm > truth);
  assert.ok(postprocess > rearm);
  assert.match(implementation, /maxStarts: 5/);
  assert.match(implementation, /maxMonitors: 100/);
  assert.match(implementation, /maxRuns: 60/);
  assert.match(implementation, /maxRuns: 30/);
  assert.match(implementation, /maxItems: 10/);
});

test("Shopling 실행 경로는 process-local coalescing과 별도 Supabase RPC lease를 함께 사용한다", async () => {
  const pulse = await read("src/lib/seoRunShoplingWorkerPulse.ts");
  const control = await read("src/lib/seoRunShoplingWorkerControl.ts");
  assert.match(pulse, /localPulsePromise/);
  assert.match(pulse, /claimSeoRunShoplingWorkerPulse/);
  assert.match(pulse, /finishSeoRunShoplingWorkerPulse/);
  assert.match(pulse, /runSeoRunShoplingPulseWork/);
  assert.match(pulse, /pulseClaimed: false/);
  assert.match(control, /claim_seo_run_shopling_worker_pulse/);
  assert.match(control, /finish_seo_run_shopling_worker_pulse/);
  assert.doesNotMatch(control, /claim_seo_run_worker_pulse/);
});

test("복구 migration은 lease만 복원하고 별도 pg_cron·HTTP fanout은 만들지 않는다", async () => {
  const migration = await read(
    "supabase/migrations/202608290001_restore_seo_run_shopling_worker_control.sql",
  );
  const vercel = JSON.parse(await read("vercel.json"));
  assert.match(migration, /seo_run_shopling_worker_control/);
  assert.match(migration, /claim_seo_run_shopling_worker_pulse/);
  assert.match(migration, /finish_seo_run_shopling_worker_pulse/);
  assert.match(
    migration,
    /revoke all on table public\.seo_run_shopling_worker_control[\s\S]*from public, anon, authenticated/,
  );
  assert.doesNotMatch(migration, /cron\.schedule/);
  assert.doesNotMatch(migration, /net\.http_get/);
  assert.deepEqual(vercel.crons, [
    { path: "/api/cron/ops-dispatcher", schedule: "* * * * *" },
  ]);
});

test("SEO 대량등록 클라우드는 Shopling 등록 실패 사유와 상품별 재시도 버튼을 보여준다", async () => {
  const page = await read("src/app/seo-bulk-cloud/page.tsx");
  const panel = await read(
    "src/app/seo-bulk-cloud/SeoBulkRegistrationFailurePanel.tsx",
  );
  assert.match(page, /SeoBulkRegistrationFailurePanel/);
  assert.match(panel, /registration_status === "failed"/);
  assert.match(panel, /registration_payload/);
  assert.match(panel, /실패 사유/);
  assert.match(panel, /등록 실패 다시시도/);
  assert.match(panel, /action: "queue_registration"/);
  assert.match(panel, /SEO FINAL 결과는 그대로 보존/);
});

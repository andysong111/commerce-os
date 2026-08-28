import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const seoPulseUrl = new URL(
  "../src/app/api/seo-run-wakeup/route.ts",
  import.meta.url,
);
const shoplingPulseUrl = new URL(
  "../src/app/api/seo-run-shopling-wakeup/route.ts",
  import.meta.url,
);
const pulseWorkUrl = new URL(
  "../src/lib/seoRunShoplingPulseWork.ts",
  import.meta.url,
);
const controlUrl = new URL(
  "../src/lib/seoRunShoplingWorkerControl.ts",
  import.meta.url,
);
const migrationUrl = new URL(
  "../supabase/migrations/202608280006_seo_run_shopling_worker_split.sql",
  import.meta.url,
);

test("기존 SEO cron은 migration 전에는 bounded Shopling fallback을 유지하고 별도 lease가 생기면 자동 분리된다", async () => {
  const source = await readFile(seoPulseUrl, "utf8");
  assert.match(source, /processSeoRunQueue/);
  assert.match(source, /claimSeoRunShoplingWorkerPulse/);
  assert.match(source, /dedicatedShoplingLeaseMissing/);
  assert.match(source, /mode: "global-fallback-pending-migration"/);
  assert.match(source, /if \(!dedicatedShoplingLeaseAvailable\)/);
  assert.match(source, /mode: "global-fallback"/);
  assert.match(source, /runSeoRunShoplingPulseWork/);
  assert.match(source, /mode: "dedicated"/);
});

test("Shopling 전용 pulse는 별도 lease를 잡고 공유 Shopling 작업 묶음을 실행한다", async () => {
  const source = await readFile(shoplingPulseUrl, "utf8");
  assert.match(source, /claimSeoRunShoplingWorkerPulse/);
  assert.match(source, /runSeoRunShoplingPulseWork/);
  assert.match(source, /finishSeoRunShoplingWorkerPulse/);
  assert.match(source, /maxDuration = 120/);
  assert.doesNotMatch(source, /processSeoRunQueue/);
});

test("공유 Shopling pulse work는 등록, 진실값 대조, 재시도 준비, 후처리를 순서대로 수행한다", async () => {
  const source = await readFile(pulseWorkUrl, "utf8");
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

test("Shopling worker는 별도 RPC lease를 사용한다", async () => {
  const source = await readFile(controlUrl, "utf8");
  assert.match(source, /claim_seo_run_shopling_worker_pulse/);
  assert.match(source, /finish_seo_run_shopling_worker_pulse/);
  assert.doesNotMatch(source, /claim_seo_run_worker_pulse/);
});

test("Supabase는 Shopling 전용 wakeup을 매분 별도 스케줄한다", async () => {
  const source = await readFile(migrationUrl, "utf8");
  assert.match(source, /seo_run_shopling_worker_control/);
  assert.match(source, /commerce-os-seo-run-shopling-wakeup/);
  assert.match(source, /\* \* \* \* \*/);
  assert.match(source, /\/api\/seo-run-shopling-wakeup/);
  assert.match(source, /timeout_milliseconds := 110000/);
  assert.match(source, /revoke all on table public\.seo_run_shopling_worker_control from public, anon, authenticated/);
});

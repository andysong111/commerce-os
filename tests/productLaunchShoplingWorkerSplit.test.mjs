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
const controlUrl = new URL(
  "../src/lib/seoRunShoplingWorkerControl.ts",
  import.meta.url,
);
const migrationUrl = new URL(
  "../supabase/migrations/202608280006_seo_run_shopling_worker_split.sql",
  import.meta.url,
);

test("SEO generation pulse는 Shopling 등록큐를 더 이상 점유하지 않는다", async () => {
  const source = await readFile(seoPulseUrl, "utf8");
  assert.match(source, /processSeoRunQueue/);
  assert.doesNotMatch(source, /processSeoRunShoplingRegistrationQueue/);
  assert.doesNotMatch(source, /reconcileVerifiedShoplingRegistrations/);
  assert.doesNotMatch(source, /processProductLaunchShoplingPostprocessQueue/);
});

test("Shopling 전용 pulse는 등록, 진실값 대조, 재시도 준비, 후처리를 독립 실행한다", async () => {
  const source = await readFile(shoplingPulseUrl, "utf8");
  assert.match(source, /claimSeoRunShoplingWorkerPulse/);
  assert.match(source, /processSeoRunShoplingRegistrationQueue/);
  assert.match(source, /maxStarts: 5/);
  assert.match(source, /maxMonitors: 100/);
  assert.match(source, /reconcileVerifiedShoplingRegistrations/);
  assert.match(source, /maxRuns: 60/);
  assert.match(source, /rearmFailedDurableSeoRegistrationRuns/);
  assert.match(source, /maxRuns: 30/);
  assert.match(source, /processProductLaunchShoplingPostprocessQueue/);
  assert.match(source, /maxItems: 10/);
  assert.match(source, /maxDuration = 120/);
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

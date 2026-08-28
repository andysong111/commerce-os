import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const dashboard = readFileSync("src/lib/commerceOperationsDashboard.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/202608170004_commerce_operation_runs_read_indexes.sql",
  "utf8",
);

function minuteSet(schedule) {
  const minute = String(schedule).trim().split(/\s+/)[0];
  if (minute === "*") return new Set(Array.from({ length: 60 }, (_, index) => index));
  const values = minute.split(",").map((value) => Number(value));
  assert.ok(values.every((value) => Number.isInteger(value) && value >= 0 && value < 60));
  return new Set(values);
}

test("DB recovery mode bounds queue wakeups instead of continuously polling empty queues", () => {
  const everyMinute = vercel.crons.filter((cron) => cron.schedule === "* * * * *");
  assert.deepEqual(everyMinute, []);

  const seo = vercel.crons.find((cron) => cron.path === "/api/cron/seo-run-worker");
  const detail = vercel.crons.find((cron) => cron.path === "/api/cron/detail-page-jobs");
  const shopling = vercel.crons.find(
    (cron) => cron.path === "/api/cron/shopling-price-bulk-auto",
  );
  assert.ok(seo);
  assert.ok(detail);
  assert.ok(shopling);
  assert.equal(minuteSet(seo.schedule).size, 12, "SEO durable recovery stays within 5 minutes");
  assert.equal(minuteSet(detail.schedule).size, 12, "detail-page recovery stays within 5 minutes");
  assert.equal(minuteSet(shopling.schedule).size, 4, "idle price worker is capped at four wakeups per hour");
});

test("all OPS cron wakeups are minute-staggered during Supabase recovery", () => {
  const paths = vercel.crons.map((cron) => cron.path);
  assert.equal(new Set(paths).size, paths.length, "duplicate cron path detected");

  const perMinute = Array.from({ length: 60 }, () => []);
  for (const cron of vercel.crons) {
    for (const minute of minuteSet(cron.schedule)) perMinute[minute].push(cron.path);
  }

  const busiest = Math.max(...perMinute.map((entries) => entries.length));
  assert.ok(busiest <= 1, `background workers still collide in the same minute: ${busiest}`);

  for (const path of [
    "/api/cron/product-decision-live-refresh",
    "/api/cron/product-master-shopling-diagnostic",
    "/api/cron/product-master-shopling-sales-backfill",
    "/api/cron/product-master-shopling-sales-incremental",
    "/api/cron/product-master-shopling-sales-events",
    "/api/cron/stage8-canonical-demand-parity",
    "/api/cron/stage8-canonical-sales-event-incremental-shadow",
    "/api/cron/stage8-canonical-event-mismatch-evidence",
    "/api/cron/stage8-canonical-sales-event-full-audit",
    "/api/cron/receipt-live-price-proposals",
    "/api/cron/receipt-live-price-canary-preflight",
    "/api/cron/price-grade-receipt-shadow-bootstrap",
  ]) {
    const cron = vercel.crons.find((entry) => entry.path === path);
    assert.ok(cron, `missing cron: ${path}`);
    assert.equal(minuteSet(cron.schedule).size, 1, `${path} should have one minute slot per eligible hour`);
  }
});

test("operations dashboard shares a short server snapshot instead of hitting Supabase per tab", () => {
  assert.match(dashboard, /unstable_cache/);
  assert.match(dashboard, /commerce-operations-dashboard-v2/);
  assert.match(dashboard, /DASHBOARD_REVALIDATE_SECONDS = 15/);
  assert.match(dashboard, /commerce_operation_runs/);
  assert.match(dashboard, /commerce_data_source_health/);
  assert.match(dashboard, /shopling_price_adjustment_bulk_jobs/);
});

test("operation ledger has correlation-aware recency indexes for worker read models", () => {
  assert.match(migration, /commerce_operation_runs_correlation_started_idx/);
  assert.match(migration, /\(correlation_id, started_at desc\)/);
  assert.match(migration, /commerce_operation_runs_type_correlation_started_idx/);
  assert.match(migration, /\(operation_type, correlation_id, started_at desc\)/);
});

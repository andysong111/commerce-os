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

test("latency-sensitive price, detail and durable SEO workers remain every minute", () => {
  const everyMinute = vercel.crons
    .filter((cron) => cron.schedule === "* * * * *")
    .map((cron) => cron.path)
    .sort();
  assert.deepEqual(everyMinute, [
    "/api/cron/detail-page-jobs",
    "/api/cron/seo-run-worker",
    "/api/cron/shopling-price-bulk-auto",
  ]);
});

test("heavy OPS cron wakeups are staggered instead of thundering at minute zero", () => {
  const paths = vercel.crons.map((cron) => cron.path);
  assert.equal(new Set(paths).size, paths.length, "duplicate cron path detected");

  const perMinute = Array.from({ length: 60 }, () => []);
  for (const cron of vercel.crons) {
    if (cron.schedule === "* * * * *") continue;
    for (const minute of minuteSet(cron.schedule)) perMinute[minute].push(cron.path);
  }

  const busiest = Math.max(...perMinute.map((entries) => entries.length));
  assert.ok(busiest <= 1, `noncritical cron collision detected: ${busiest}`);

  const longRunningPaths = [
    "/api/cron/product-master-shopling-diagnostic",
    "/api/cron/product-master-shopling-sales-backfill",
    "/api/cron/product-master-shopling-sales-incremental",
    "/api/cron/product-master-shopling-sales-events",
    "/api/cron/stage8-canonical-demand-parity",
    "/api/cron/stage8-canonical-sales-event-incremental-shadow",
    "/api/cron/stage8-canonical-event-mismatch-evidence",
    "/api/cron/stage8-canonical-sales-event-full-audit",
  ];
  for (const path of longRunningPaths) {
    const cron = vercel.crons.find((entry) => entry.path === path);
    assert.ok(cron, `missing cron: ${path}`);
    assert.notEqual(cron.schedule, "* * * * *", `${path} must not run every minute`);
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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const dashboard = readFileSync("src/lib/commerceOperationsDashboard.ts", "utf8");
const scheduler = readFileSync(
  "supabase/migrations/202608280009_ops_adaptive_dispatcher.sql",
  "utf8",
);
const operationIndexes = readFileSync(
  "supabase/migrations/202608170004_commerce_operation_runs_read_indexes.sql",
  "utf8",
);

const ROUTES = [
  "/api/cron/seo-run-worker",
  "/api/cron/detail-page-jobs",
  "/api/cron/shopling-price-bulk-auto",
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
  "/api/cron/ops-storage-maintenance",
];

test("Vercel has one lightweight heartbeat and no independent worker fanout", () => {
  assert.deepEqual(vercel.crons, [
    { path: "/api/cron/ops-dispatcher", schedule: "* * * * *" },
  ]);
});

test("all former cron routes are durable DB tasks with one global lease", () => {
  assert.match(scheduler, /create table if not exists public\.ops_dispatch_state/);
  assert.match(scheduler, /create table if not exists public\.ops_dispatch_tasks/);
  assert.match(scheduler, /claim_next_ops_dispatch_task/);
  assert.match(scheduler, /finish_ops_dispatch_task/);
  assert.match(scheduler, /for update of task skip locked/);
  for (const route of ROUTES) {
    assert.ok(scheduler.includes(`'${route}'`), `missing dispatcher route: ${route}`);
  }
});

test("database recovery mode runs only critical queues and backs off background analysis", () => {
  assert.match(scheduler, /v_state\.mode <> 'recovery' or task\.workload_class = 'critical'/);
  assert.match(scheduler, /interval '15 minutes'/);
  assert.match(scheduler, /normal_interval_seconds/);
  assert.match(scheduler, /busy_interval_seconds/);
  assert.match(scheduler, /recovery_interval_seconds/);
  assert.match(scheduler, /'seo-run-worker'.*'critical'/s);
  assert.match(scheduler, /'detail-page-jobs'.*'critical'/s);
  assert.match(scheduler, /'shopling-price-bulk-auto'.*'critical'/s);
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
  assert.match(operationIndexes, /commerce_operation_runs_correlation_started_idx/);
  assert.match(operationIndexes, /\(correlation_id, started_at desc\)/);
  assert.match(operationIndexes, /commerce_operation_runs_type_correlation_started_idx/);
  assert.match(operationIndexes, /\(operation_type, correlation_id, started_at desc\)/);
});

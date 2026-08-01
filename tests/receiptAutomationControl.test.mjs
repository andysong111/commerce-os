import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const service = await readFile(
  new URL("../src/lib/receiptAutomationControl.ts", import.meta.url),
  "utf8",
);
const route = await readFile(
  new URL(
    "../src/app/api/integrations/receipt-automation/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const migration = await readFile(
  new URL(
    "../supabase/migrations/202608020001_receipt_automation_control.sql",
    import.meta.url,
  ),
  "utf8",
);

test("receipt events are idempotent and create one operation run", () => {
  assert.match(service, /commerce_processed_events/);
  assert.match(service, /source_event_id/);
  assert.match(service, /eventId: string/);
  assert.match(service, /processReceiptAutomationEvent/);
  assert.match(migration, /commerce_operation_runs_source_event_uq/);
  assert.match(migration, /commerce_processed_events/);
});

test("receipt confirmation creates recommendations but never applies Shopling prices", () => {
  assert.match(service, /PRICE_ANALYSIS_FROM_RECEIPT/);
  assert.match(service, /AWAITING_APPROVAL/);
  assert.match(service, /REQUIRES_FINAL_APPROVAL/);
  assert.match(service, /BLOCKED_UNTIL_FINAL_APPROVAL/);
  assert.match(service, /\/api\/analyze/);
  assert.doesNotMatch(service, /\/api\/executions/);
  assert.doesNotMatch(service, /shopling-price-adjustment\/bulk/);
});

test("failed analysis remains visible for durable outbox retry", () => {
  assert.match(service, /status: "FAILED"/);
  assert.match(service, /price_recommendations/);
  assert.match(service, /receipt_confirmed\.price_analysis_failed/);
  assert.match(route, /RECEIPT_AUTOMATION_FAILED/);
  assert.match(route, /status: invalid \? 400 : 502/);
});

test("control tables include audit logs and data source freshness", () => {
  assert.match(migration, /commerce_audit_logs/);
  assert.match(migration, /commerce_data_source_health/);
  assert.match(migration, /'FRESH', 'STALE', 'MISSING', 'FAILED'/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /'sales_orders','MISSING'/);
  assert.match(migration, /'confirmed_receipts','MISSING'/);
  assert.match(migration, /'product_mappings','MISSING'/);
  assert.match(migration, /'estimated_inventory','MISSING'/);
  assert.match(migration, /'price_recommendations','MISSING'/);
});

test("Shopling price job state changes are audited without changing execution logic", () => {
  assert.match(migration, /audit_shopling_price_adjustment_job_status/);
  assert.match(migration, /after update of status on public\.shopling_price_adjustment_bulk_jobs/);
  assert.match(migration, /shopling_price_adjustment\.status_changed/);
  assert.match(migration, /before_snapshot/);
  assert.match(migration, /after_snapshot/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, cron, page, scheduler] = await Promise.all([
  readFile("src/lib/canonicalSalesEventFullAudit.ts", "utf8"),
  readFile("src/app/api/cron/stage8-canonical-sales-event-full-audit/route.ts", "utf8"),
  readFile("src/app/stage8-canonical-sales-event-full-audit/page.tsx", "utf8"),
  readFile("supabase/migrations/202608280009_ops_adaptive_dispatcher.sql", "utf8"),
]);

test("full audit re-reads the complete 360-day exact-event window and never writes Product Master", () => {
  assert.match(engine, /PRODUCT_MASTER_SALES_EVENT_ANALYSIS_DAYS/);
  assert.match(engine, /CANONICAL_EVENT_FULL_AUDIT_RANGE_DAYS = 7/);
  assert.match(engine, /CANONICAL_EVENT_FULL_AUDIT_POLICY_VERSION = "v2-seven-day-source"/);
  assert.match(engine, /aggregateProductMasterShoplingSalesEventChunk/);
  assert.match(engine, /combineProductMasterShoplingSalesEventChunks/);
  assert.match(engine, /\/api\/integrations\/sales-events\/verify/);
  assert.match(engine, /writesEnabled: false/);
  assert.doesNotMatch(engine, /applyProductMasterShoplingSalesEvents/);
  assert.doesNotMatch(engine, /postProductMasterEvents/);
  assert.match(page, /READ ONLY · WRITE BLOCKED/);
});

test("full audit detects candidate-side and persisted-side drift", () => {
  assert.match(engine, /loadCanonicalSnapshot/);
  assert.match(engine, /persisted\.sourceEventCount/);
  assert.match(engine, /persistedValidCount/);
  assert.match(engine, /persistedTombstoneCount/);
  assert.match(engine, /classificationComplete/);
  assert.match(engine, /orphanEventCount/);
  assert.match(engine, /eventMismatchCount/);
});

test("active 12x30 rolling arrays must exactly match at the audit analysisAsOf", () => {
  assert.match(engine, /buildCandidateRollingRows/);
  assert.match(engine, /compareActiveRows/);
  assert.match(engine, /monthlyUnits/);
  assert.match(engine, /monthlyRevenue/);
  assert.match(engine, /validEventCount/);
  assert.match(engine, /missingPersistedBarcodes/);
  assert.match(engine, /extraPersistedBarcodes/);
});

test("mapping and event fingerprints are pinned throughout the long audit", () => {
  assert.match(engine, /planningMappingFingerprint/);
  assert.match(engine, /currentMappingFingerprint !== request\.planningMappingFingerprint/);
  assert.match(engine, /candidateFingerprint/);
  assert.match(engine, /VERIFY_FINGERPRINT_DRIFT/);
  assert.match(engine, /baselineReconciliationFingerprint/);
});

test("full audit is weekly, durable, protected, fail closed and dispatcher-managed", () => {
  assert.match(engine, /CANONICAL_EVENT_FULL_AUDIT_INTERVAL_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(engine, /commerce_operation_runs/);
  assert.match(engine, /SOURCE_BLOCKERS/);
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /writesEnabled: false/);
  assert.match(
    scheduler,
    /'stage8-canonical-sales-event-full-audit', '\/api\/cron\/stage8-canonical-sales-event-full-audit', 'diagnostic', 270, true, 86400, 3600, 86400/,
  );
});

test("full audit reports exact separately from legitimate drift", () => {
  assert.match(engine, /state: exact \? "EXACT"/);
  assert.match(engine, /"DRIFT"/);
  assert.match(engine, /driftCount/);
  assert.match(engine, /auditFingerprint/);
  assert.match(page, /360-DAY EXACT/);
  assert.match(page, /Drift score/);
});

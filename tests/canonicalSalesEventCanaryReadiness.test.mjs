import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, page] = await Promise.all([
  readFile("src/lib/canonicalSalesEventCanaryReadiness.ts", "utf8"),
  readFile("src/app/stage8-canonical-sales-event-canary-readiness/page.tsx", "utf8"),
]);

test("canary readiness is read only and caps future execution at exactly one event", () => {
  assert.match(engine, /automaticWriteEnabled: false/);
  assert.match(engine, /maxWriteRows: 1/);
  assert.match(engine, /READY_ONE_EVENT/);
  assert.doesNotMatch(engine, /\/api\/integrations\/sales-events["'`]/);
  assert.doesNotMatch(engine, /method:\s*["']POST["']/);
  assert.match(page, /AUTOMATIC WRITE DISABLED/);
  assert.match(page, /상시 write endpoint는 만들지 않습니다/);
});

test("gate requires matching incremental and mismatch evidence fingerprints", () => {
  assert.match(engine, /candidate-fingerprint-match/);
  assert.match(engine, /evidenceReport\.candidateFingerprint === incrementalReport\.candidateFingerprint/);
  assert.match(engine, /evidence-all-canary-safe/);
  assert.match(engine, /unsafeForCanaryCount === 0/);
});

test("gate requires a recent exact 360-day audit on the same current identity mapping", () => {
  assert.match(engine, /recent-full-audit-exact/);
  assert.match(engine, /MAX_EXACT_AUDIT_AGE_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(engine, /full-audit-mapping-match/);
  assert.match(engine, /auditReport!\.planningMappingFingerprint === currentMappingFingerprint/);
  assert.match(engine, /current-mapping-stable/);
});

test("baseline reconciliation fingerprint must remain pinned", () => {
  assert.match(engine, /baseline-reconciliation-ready/);
  assert.match(engine, /reconciliation\.reconciliationFingerprint === incrementalReport\.baselineReconciliationFingerprint/);
  assert.match(engine, /full-audit-baseline-match/);
});

test("unsafe identity metadata and occurredAt changes cannot be selected", () => {
  assert.match(engine, /"ID", "SOURCE", "EXTERNAL_ID", "OCCURRED_AT", "SKU_IDENTITY"/);
  assert.match(engine, /deterministic-one-event/);
  assert.match(engine, /left\.externalId\.localeCompare\(right\.externalId\)/);
});

test("zero mismatch evidence exits without requesting a write", () => {
  assert.match(engine, /state: "NO_CHANGES"/);
  assert.match(engine, /canary write가 필요하지 않습니다/);
  assert.match(page, /NO CHANGES · NO WRITE NEEDED/);
});

test("ready gate produces a fingerprinted canary token for a future one-shot executor", () => {
  assert.match(engine, /makeCanaryToken/);
  assert.match(engine, /incrementalCandidateFingerprint/);
  assert.match(engine, /fullAuditFingerprint/);
  assert.match(engine, /selectedExternalId/);
  assert.match(page, /Canary token/);
});

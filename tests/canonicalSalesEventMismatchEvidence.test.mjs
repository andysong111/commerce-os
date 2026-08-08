import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [engine, cron, page, vercel] = await Promise.all([
  readFile("src/lib/canonicalSalesEventMismatchEvidence.ts", "utf8"),
  readFile("src/app/api/cron/stage8-canonical-event-mismatch-evidence/route.ts", "utf8"),
  readFile("src/app/stage8-canonical-event-mismatch-evidence/page.tsx", "utf8"),
  readFile("vercel.json", "utf8"),
]);

test("mismatch evidence only rereads persisted state and never writes sales events", () => {
  assert.match(engine, /\/api\/integrations\/sales-events\/verify/);
  assert.match(engine, /mismatchDetails/);
  assert.match(engine, /writesEnabled: false/);
  assert.match(engine, /automaticWriteEnabled: false/);
  assert.doesNotMatch(engine, /\/api\/integrations\/sales-events["'`]/);
  assert.doesNotMatch(engine, /applyProductMasterShoplingSalesEvents/);
  assert.match(page, /AUTOMATIC WRITE OFF/);
});

test("future candidates are classified by persisted before state", () => {
  assert.match(engine, /"MISSING"/);
  assert.match(engine, /"VALID_SALE"/);
  assert.match(engine, /"QUANTITY"/);
  assert.match(engine, /"REVENUE"/);
  assert.match(engine, /"OCCURRED_AT"/);
  assert.match(engine, /"SKU_IDENTITY"/);
  assert.match(engine, /changeKind/);
  assert.match(page, /NEW\/상태\/수량\/매출\/시각\/identity/);
});

test("identity metadata or occurredAt differences block canary eligibility", () => {
  assert.match(engine, /identityMismatchCount/);
  assert.match(engine, /metadataChangeCount/);
  assert.match(engine, /occurredAtChangeCount/);
  assert.match(engine, /\["ID", "SOURCE", "EXTERNAL_ID", "OCCURRED_AT", "SKU_IDENTITY"\]/);
  assert.match(engine, /canaryEligible:/);
});

test("evidence is pinned to the completed shadow candidate fingerprint", () => {
  assert.match(engine, /shadowReport\.candidateFingerprint/);
  assert.match(engine, /MISMATCH_EVIDENCE_CANDIDATE_FINGERPRINT_DRIFT/);
  assert.match(engine, /MISMATCH_EVIDENCE_SHADOW_COUNT_DRIFT/);
  assert.match(engine, /MISMATCH_EVIDENCE_PERSISTED_CHANGED_SINCE_SHADOW/);
  assert.match(engine, /mismatchIdsFromVerifyRows/);
});

test("no-change shadow produces durable zero evidence without Product Master detail calls", () => {
  assert.match(engine, /shadowReport\.pendingMismatchCount === 0/);
  assert.match(engine, /state: "NO_CHANGES"/);
  assert.match(engine, /inspectedMismatchCount: 0/);
  assert.match(engine, /CANONICAL_EVENT_MISMATCH_EVIDENCE_REPORT/);
});

test("cron is protected and scheduled while business writes remain disabled", () => {
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /writesEnabled: false/);
  assert.match(vercel, /stage8-canonical-event-mismatch-evidence/);
});

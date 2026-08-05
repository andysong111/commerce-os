import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [audit, cron, page, shadowPage, bootstrap] = await Promise.all([
  readFile("src/lib/priceGradeBlockedReasonAudit.ts", "utf8"),
  readFile(
    "src/app/api/cron/price-grade-receipt-shadow-bootstrap/route.ts",
    "utf8",
  ),
  readFile("src/app/price-adjustment-engine/blocked-reasons/page.tsx", "utf8"),
  readFile("src/app/price-adjustment-engine/shadow-compare/page.tsx", "utf8"),
  readFile("src/lib/priceGradeReceiptShadowBootstrap.ts", "utf8"),
]);

test("audit recalculates every receipt-augmented input and counts all blocked reasons", () => {
  assert.match(audit, /PRICE_GRADE_BLOCKED_REASON_AUDIT_VERSION/);
  assert.match(audit, /loadPriceGradeInputSnapshot/);
  assert.match(audit, /readPriceAdjustmentReceiptCache/);
  assert.match(audit, /augmentPriceGradeSnapshotWithReceiptCache/);
  assert.match(audit, /for \(const input of augmented\.snapshot\.inputs\)/);
  assert.match(audit, /calculateProductPriceGrade/);
  assert.match(audit, /blockedInputCount \+= 1/);
  assert.match(audit, /for \(const reason of reasons\) increment\(reasonCounts, reason\)/);
  assert.match(audit, /increment\(combinationCounts, reasons\.join\(" \+ "\)\)/);
  assert.match(audit, /blockedWithExistingLifecycleCount/);
  assert.match(audit, /blockedWithoutExistingLifecycleCount/);
});

test("audit stores only bounded diagnostic samples and never enables business writes", () => {
  assert.match(audit, /const MAX_SAMPLES = 100/);
  assert.match(audit, /if \(samples\.length < MAX_SAMPLES\)/);
  assert.match(audit, /PRICE_GRADE_BLOCKED_REASON_AUDIT/);
  assert.match(audit, /resolution=ignore-duplicates/);
  assert.match(audit, /writesEnabled: false/);
  assert.doesNotMatch(
    audit,
    /shopling.*(?:modify|update|write)|inventory.*(?:modify|update|write)|1688/i,
  );
});

test("five-minute worker reuses a matching audit and logs compact reason totals", () => {
  assert.match(audit, /loadLatestPriceGradeBlockedReasonAudit/);
  assert.match(audit, /latest\.contentFingerprint === expectedFingerprint/);
  assert.match(audit, /reason: "ALREADY_CURRENT"/);
  assert.match(audit, /compactPriceGradeBlockedReasonAudit/);
  assert.match(cron, /ensurePriceGradeBlockedReasonAudit/);
  assert.match(cron, /bootstrap\.contentFingerprint/);
  assert.match(cron, /\[price-grade-blocked-reason-audit\]/);
  assert.match(cron, /reasonCounts: audit\.reasonCounts/);
  assert.match(cron, /combinationCounts: audit\.combinationCounts/);
  assert.match(cron, /writesEnabled: false/);
});

test("operator pages expose the full audit without connecting to a price executor", () => {
  assert.match(page, /상품등급 차단 원인/);
  assert.match(page, /원인별 전체 건수/);
  assert.match(page, /원인 조합별 상품 수/);
  assert.match(page, /보완 후 원가 없음/);
  assert.match(page, /실제 가격변경/);
  assert.match(shadowPage, /\/price-adjustment-engine\/blocked-reasons/);
  assert.doesNotMatch(page, /shopling-price-modify-runner|approve|execute/i);
});

test("bootstrap exposes the exact augmented fingerprint consumed by the audit", () => {
  assert.match(bootstrap, /contentFingerprint: string \| null/);
  assert.match(bootstrap, /contentFingerprint: latest\.contentFingerprint/);
  assert.match(bootstrap, /contentFingerprint: result\.contentFingerprint/);
});

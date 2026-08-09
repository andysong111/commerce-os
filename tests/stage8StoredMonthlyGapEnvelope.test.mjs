import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/lib/stage8StoredMonthlyGapEnvelope.ts", import.meta.url),
  "utf8",
);
const pageSource = fs.readFileSync(
  new URL("../src/app/stage8-stored-monthly-gap-envelope/page.tsx", import.meta.url),
  "utf8",
);

test("stored monthly evidence is accepted only from a completed zero-unmapped backfill", () => {
  assert.match(source, /backfill\.state === "COMPLETED"/);
  assert.match(source, /backfill\.completedRanges === backfill\.totalRanges/);
  assert.match(source, /backfill\.report\?\.unmappedRows \?\? 0\) === 0/);
  assert.match(source, /rangesCover\(gapStartDate, gapEndDate, storedRanges\)/);
});

test("an absent SKU-month row is never converted into zero sales", () => {
  assert.match(source, /MONTHLY_IDENTITY_COVERAGE_UNPROVEN/);
  assert.match(source, /requiredMonths\.every\(\(month\) => monthMap\.has\(month\)\)/);
  assert.match(source, /행 부재를 0판매로 간주하지 않습니다/);
  assert.match(source, /explicitEvidenceMonthCount/);
  assert.match(source, /requiredEvidenceMonthCount/);
  assert.doesNotMatch(source, /monthMap\.get\([^)]*\) \?\? 0/);
});

test("boundary months remain uncertainty only after explicit identity coverage is proven", () => {
  assert.match(source, /if \(!identityCoverageReady\)/);
  assert.match(source, /gapSalesLowerBound = interiorFullMonthQuantity/);
  assert.match(
    source,
    /interiorFullMonthQuantity \+ startMonthQuantity \+ endMonthQuantity/,
  );
  assert.match(
    source,
    /latestOrderQuantity - canonicalSalesAfterGap - gapSalesUpperBound/,
  );
  assert.match(
    source,
    /latestOrderQuantity - canonicalSalesAfterGap - gapSalesLowerBound/,
  );
  assert.doesNotMatch(source, /\/\s*30/);
  assert.doesNotMatch(source, /\/\s*31/);
});

test("monthly bounds feed the existing fail-closed purchase envelope", () => {
  assert.match(source, /calculateNetRequirement/);
  assert.match(source, /buildProvisionalDecisionEnvelope/);
  assert.match(source, /actualDraftCreationEnabled: false/);
  assert.match(source, /inventoryPromotionAllowed: false/);
  assert.match(source, /purchaseWritesEnabled: false/);
  assert.match(source, /inventoryWritesEnabled: false/);
});

test("stored evidence path performs no business mutation", () => {
  assert.doesNotMatch(source, /\.from\([^\n]+\)[\s\S]{0,200}\.insert\(/);
  assert.doesNotMatch(source, /\.from\([^\n]+\)[\s\S]{0,200}\.update\(/);
  assert.doesNotMatch(source, /\.from\([^\n]+\)[\s\S]{0,200}\.upsert\(/);
  assert.doesNotMatch(source, /fetch\([^)]*method:\s*["'](?:POST|PUT|PATCH|DELETE)/i);
});

test("operator page exposes evidence-month gaps and zero writes", () => {
  assert.match(pageSource, /ABSENT MONTHLY ROW ≠ ZERO SALES · FAIL CLOSED/);
  assert.match(pageSource, /정체성 미증명/);
  assert.match(pageSource, /Actual write/);
  assert.match(pageSource, /0 · READ ONLY/);
  assert.match(pageSource, /월행 부재를 0으로 채우지 않습니다/);
});

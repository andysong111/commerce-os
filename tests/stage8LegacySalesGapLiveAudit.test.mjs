import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const audit = await readFile(
  "src/lib/stage8LegacySalesGapLiveAudit.ts",
  "utf8",
);
const page = await readFile(
  "src/app/stage8-legacy-sales-gap-live-audit/page.tsx",
  "utf8",
);

test("historical gap live audit is fixed to BGG1-1 and bounded before canonical 360 days", () => {
  assert.match(audit, /TARGET_BARCODE = "BGG1-1"/);
  assert.match(audit, /SCAN_START = "2025-04-01"/);
  assert.match(audit, /MAX_RANGE_DAYS = 30/);
  assert.match(audit, /ranges\.length > 5/);
  assert.match(audit, /dayBefore\(canonicalWindowStart\)/);
  assert.match(page, /maxDuration = 300/);
});

test("audit reads Shopling orders only and never writes business data", () => {
  assert.match(audit, /client\.read\("orders", range\)/);
  assert.match(audit, /sourceReadsPerformed:\s*true/);
  assert.match(audit, /businessWritesPerformed:\s*false/);
  assert.match(audit, /inventoryUseAllowed:\s*false/);
  assert.match(audit, /operationalEstimatePromotionAllowed:\s*false/);
  assert.doesNotMatch(audit, /method:\s*["']POST/);
  assert.doesNotMatch(audit, /upsert|insert|delete/);
});

test("audit separates canonical resolution from validation-only legacy model evidence", () => {
  assert.match(audit, /aggregateProductMasterShoplingSalesChunk/);
  assert.match(audit, /canonicalTargetUnits/);
  assert.match(audit, /currentIdentityUnits/);
  assert.match(audit, /legacyModelCurrentIdentityUnits/);
  assert.match(audit, /modelNameOnlyOrderRows/);
  assert.match(audit, /foreignBcodeConflictRows/);
  assert.match(audit, /unresolvedPackRows/);
  assert.match(page, /자동 승격 금지/);
});

test("audit never exposes order numbers or buyer fields", () => {
  assert.doesNotMatch(page, /orderNo|ord_no|mall_login_id|buyer|수취인|전화/);
});

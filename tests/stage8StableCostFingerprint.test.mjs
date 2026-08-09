import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  "src/lib/stage8LegacyVerifiedCostReadiness.ts",
  "utf8",
);

test("cost readiness fingerprint excludes request-time generatedAt values", () => {
  const fingerprintBlock = source.slice(source.indexOf("fingerprint: fingerprint({"));
  assert.doesNotMatch(fingerprintBlock, /priorityGeneratedAt|priority\.generatedAt/);
  assert.match(fingerprintBlock, /priorityState: priority\.state/);
  assert.match(fingerprintBlock, /purchaseShadowReady: priority\.purchaseShadowReady/);
  assert.match(fingerprintBlock, /managedActiveSkuCount: priority\.managedActiveSkuCount/);
});

test("content fingerprint includes purchase, identity, cost evidence and inventory state", () => {
  assert.match(source, /name: row\.name/);
  assert.match(source, /modelNo: row\.modelNo/);
  assert.match(source, /recommendedQty: row\.recommendedQty/);
  assert.match(source, /shadowExpectedCost: row\.shadowExpectedCost/);
  assert.match(source, /evidenceUnitCostKrw: row\.evidenceUnitCostKrw/);
  assert.match(source, /inventoryVerified: row\.inventoryVerified/);
  assert.match(source, /initialZeroUnverified: row\.initialZeroUnverified/);
  assert.match(source, /inventoryRequiresReview: row\.inventoryRequiresReview/);
});

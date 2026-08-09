import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { legacyModelIdentityEvidence } from "../src/data/stage8LegacyModelIdentityEvidence.ts";

const recoverySource = fs.readFileSync(
  new URL("../src/lib/stage8PurchaseCandidateLegacyModelRecovery.ts", import.meta.url),
  "utf8",
);
const pageSource = fs.readFileSync(
  new URL("../src/app/stage8-purchase-candidate-legacy-model-recovery/page.tsx", import.meta.url),
  "utf8",
);

test("direct evidence contains only the five currently proven B-code to aaa mappings", () => {
  const rows = legacyModelIdentityEvidence();
  assert.deepEqual(
    rows.map((row) => [row.barcode, row.recoveredModelNo]).sort(),
    [
      ["BGB1-1", "aaa266"],
      ["BGD2-1", "aaa409"],
      ["BGE1-1", "aaa045"],
      ["BGE2-1", "aaa045"],
      ["BGG1-1", "aaa316"],
    ],
  );
  assert.equal(rows.every((row) => row.confidence === "EXACT"), true);
  assert.equal(rows.every((row) => row.orderHistoryConfirmedInbound === false), true);
  assert.equal(rows.every((row) => row.inventoryUseAllowed === false), true);
  assert.equal(rows.every((row) => row.businessWritesEnabled === false), true);
});

test("recovery fails closed for missing or conflicting identity evidence", () => {
  assert.match(recoverySource, /PLACEHOLDER_UNRECOVERED/);
  assert.match(recoverySource, /CONFLICT/);
  assert.match(recoverySource, /orderHistoryJoinAllowed/);
  assert.match(recoverySource, /inventoryPromotionAllowed: false/);
  assert.match(recoverySource, /purchaseWritesEnabled: false/);
  assert.match(recoverySource, /inventoryWritesEnabled: false/);
  assert.doesNotMatch(recoverySource, /\.insert\(/);
  assert.doesNotMatch(recoverySource, /\.update\(/);
  assert.doesNotMatch(recoverySource, /\.upsert\(/);
  assert.doesNotMatch(recoverySource, /fetch\([^)]*method:\s*["']POST/i);
});

test("operator page clearly labels direct evidence and zero business writes", () => {
  assert.match(pageSource, /DIRECT EVIDENCE ONLY · NO NAME-ONLY GUESSING/);
  assert.match(pageSource, /Business write/);
  assert.match(pageSource, /0 · READ ONLY/);
  assert.match(pageSource, /확정입고가 아니며/);
});

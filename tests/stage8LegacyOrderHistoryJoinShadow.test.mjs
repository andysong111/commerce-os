import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { legacyOrderHistoryEvidence } from "../src/data/stage8LegacyOrderHistoryEvidence.ts";

const shadowSource = fs.readFileSync(
  new URL("../src/lib/stage8LegacyOrderHistoryJoinShadow.ts", import.meta.url),
  "utf8",
);
const pageSource = fs.readFileSync(
  new URL("../src/app/stage8-legacy-order-history-shadow/page.tsx", import.meta.url),
  "utf8",
);

function byBarcode() {
  return new Map(legacyOrderHistoryEvidence().map((row) => [row.barcode, row]));
}

test("BGG1-1 keeps exact historical order surrogate and never becomes confirmed inbound", () => {
  const row = byBarcode().get("BGG1-1");
  assert.ok(row);
  assert.equal(row.modelNo, "aaa316");
  assert.equal(row.safeCumulativeOrderQuantity, 11533);
  assert.equal(row.latestSafeOrderDate, "2025-09-29");
  assert.equal(row.latestSafeOrderQuantity, 6000);
  assert.equal(row.recentThreeOrderQuantity, 11500);
  assert.equal(row.confirmedInbound, false);
  assert.equal(row.inventoryUseAllowed, false);
});

test("aaa045 option-normalized evidence excludes ambiguous and white quantities", () => {
  const rows = byBarcode();
  const black = rows.get("BGE1-1");
  const gray = rows.get("BGE2-1");
  assert.ok(black);
  assert.ok(gray);
  assert.equal(black.modelNo, "aaa045");
  assert.equal(gray.modelNo, "aaa045");
  assert.equal(black.safeCumulativeOrderQuantity, 825);
  assert.equal(gray.safeCumulativeOrderQuantity, 870);
  assert.equal(black.latestSafeOrderQuantity, 150);
  assert.equal(gray.latestSafeOrderQuantity, 350);
  assert.equal(black.excludedAmbiguousQuantity, 30);
  assert.equal(gray.excludedAmbiguousQuantity, 30);
  assert.equal(black.unmappedOtherOptionQuantity, 60);
  assert.equal(gray.unmappedOtherOptionQuantity, 60);
  assert.equal(black.recentThreeOrderQuantity, null);
  assert.equal(gray.recentThreeOrderQuantity, null);
  assert.equal(
    black.safeCumulativeOrderQuantity +
      gray.safeCumulativeOrderQuantity +
      black.excludedAmbiguousQuantity +
      black.unmappedOtherOptionQuantity,
    1785,
  );
});

test("BGB1-1 keeps exact cumulative latest and recent-three evidence", () => {
  const row = byBarcode().get("BGB1-1");
  assert.ok(row);
  assert.equal(row.modelNo, "aaa266");
  assert.equal(row.safeCumulativeOrderQuantity, 3010);
  assert.equal(row.latestSafeOrderDate, "2025-10-01");
  assert.equal(row.latestSafeOrderQuantity, 2000);
  assert.equal(row.recentThreeOrderQuantity, 3000);
  assert.equal(row.latestOrderEvidenceState, "EXACT");
});

test("BGD2-1 permits cumulative evidence but blocks latest-order scenario until exact row exists", () => {
  const row = byBarcode().get("BGD2-1");
  assert.ok(row);
  assert.equal(row.modelNo, "aaa409");
  assert.equal(row.safeCumulativeOrderQuantity, 4910);
  assert.equal(row.recentThreeOrderQuantity, 4900);
  assert.equal(row.latestSafeOrderDate, "2026-04-01");
  assert.equal(row.latestSafeOrderQuantity, null);
  assert.equal(row.latestOrderEvidenceState, "NEEDS_EXACT_ROW");
  assert.match(shadowSource, /JOINED_CUMULATIVE_ONLY/);
  assert.match(shadowSource, /latestOrderScenarioEligible/);
});

test("all historical order evidence remains read-only non-inventory surrogate", () => {
  const rows = legacyOrderHistoryEvidence();
  assert.equal(rows.every((row) => row.evidenceKind === "ORDER_HISTORY_SURROGATE"), true);
  assert.equal(rows.every((row) => row.confirmedInbound === false), true);
  assert.equal(rows.every((row) => row.inventoryUseAllowed === false), true);
  assert.equal(rows.every((row) => row.inventoryPromotionAllowed === false), true);
  assert.equal(rows.every((row) => row.businessWritesEnabled === false), true);
  assert.match(shadowSource, /orderHistoryConfirmedInbound: false/);
  assert.match(shadowSource, /purchaseWritesEnabled: false/);
  assert.match(shadowSource, /inventoryWritesEnabled: false/);
  assert.doesNotMatch(shadowSource, /\.from\([^\n]+\)[\s\S]{0,200}\.insert\(/);
  assert.doesNotMatch(shadowSource, /\.from\([^\n]+\)[\s\S]{0,200}\.update\(/);
  assert.doesNotMatch(shadowSource, /\.from\([^\n]+\)[\s\S]{0,200}\.upsert\(/);
  assert.doesNotMatch(shadowSource, /fetch\([^)]*method:\s*["'](?:POST|PUT|PATCH|DELETE)/i);
});

test("operator page explicitly warns order history is not inbound or inventory", () => {
  assert.match(pageSource, /ORDER HISTORY ≠ CONFIRMED INBOUND ≠ CURRENT INVENTORY/);
  assert.match(pageSource, /Business write/);
  assert.match(pageSource, /0 · READ ONLY/);
  assert.match(pageSource, /825 \+ 870 \+ 30 \+ 60 = 1,785개/);
});

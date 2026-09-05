import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  "src/lib/stage8CanonicalSalesEventSnapshot.ts",
  "utf8",
);

test("Stage8 exact-inventory reads report-ready canonical states without waiting for downstream writes", () => {
  assert.match(
    source,
    /new Set\(\["READY_CANARY", "READY_FULL", "COMPLETED"\]\)/,
  );
  assert.match(source, /isStage8CanonicalSalesReportReadyState\(status\.state\)/);
  assert.doesNotMatch(source, /status\.state !== "COMPLETED"/);
});

test("Stage8 remains read only while using analysisAsOf as the no-sale coverage upper bound", () => {
  assert.match(source, /writesEnabled: false/);
  assert.match(
    source,
    /const coverageEndAt = status\.analysisAsOf \?\? orderedDates\.at\(-1\) \?\? null/,
  );
  assert.doesNotMatch(source, /method:\s*["']POST["']/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  "src/lib/priceGradeReceiptCacheShadow.ts",
  "utf8",
);

test("receipt shadow fingerprint changes with usable receipt content, not transport metadata", () => {
  const fingerprintBlock = source.slice(
    source.indexOf("const contentFingerprint = fingerprint"),
    source.indexOf("const receiptEvidence"),
  );
  assert.match(fingerprintBlock, /base: snapshot\.contentFingerprint/);
  assert.match(fingerprintBlock, /augmentationVersion: AUGMENTATION_VERSION/);
  assert.match(fingerprintBlock, /usedFallback/);
  assert.doesNotMatch(fingerprintBlock, /cacheSnapshotId|cacheGeneratedAt/);
});

test("cache transport metadata remains available as evidence without forcing recalculation", () => {
  assert.match(source, /cacheSnapshotId: cache\?\.snapshotId \?\? null/);
  assert.match(source, /cacheGeneratedAt: cache\?\.generatedAt \?\? null/);
  assert.match(source, /cacheBarcodeCount: cache\?\.barcodeCount \?\? 0/);
  assert.match(source, /loadPriceGradeReceiptAugmentedSnapshot/);
});

test("repeated identical cache snapshots cannot enable operational writes", () => {
  assert.doesNotMatch(
    source,
    /shopling.*(?:modify|update|write)|inventory.*(?:modify|update|write)|1688/i,
  );
  assert.match(source, /PRICE_GRADE_SHADOW_COMPARISON/);
  assert.match(source, /resolution=ignore-duplicates/);
});

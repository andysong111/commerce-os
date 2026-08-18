import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL(
    "../src/components/china-order-manager/InternalChinaManualDraftLineAdder.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("manual China draft add supports checkbox bulk apply", () => {
  assert.match(source, /aria-label="추가 가능한 B-code 전체선택"/);
  assert.match(source, /일괄 추가 선택/);
  assert.match(source, /async function addSelected\(\)/);
  assert.match(source, /선택 \$\{selectedCandidates\.length\}건 일괄 반영/);
  assert.match(source, /selectedTotalQuantity/);
});

test("bulk apply excludes existing draft rows and preserves per-row quantities", () => {
  assert.match(source, /selectableCandidates = candidates\.filter\(\(candidate\) => !candidate\.inDraft\)/);
  assert.match(source, /candidate\.inDraft \|\| bulkAdding/);
  assert.match(source, /quantity\(quantities\[candidate\.barcode\]\)/);
  assert.match(source, /await postAdd\(candidate\)/);
});

test("bulk apply refreshes totals once without forcing a full location reload", () => {
  assert.match(source, /router\.refresh\(\)/);
  assert.doesNotMatch(source, /window\.location\.reload/);
});

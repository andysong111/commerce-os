import assert from "node:assert/strict";
import test from "node:test";

import { generateFinalKeywordOnlySeoTitleInventory } from "../src/lib/seoTitleFinalKeywordInventoryGenerator.ts";
import {
  keywordElonSeoCanonical,
  keywordElonSeoUtf8Bytes,
} from "../src/lib/keywordEngineElonLabSeoOutput.ts";

const KEYWORDS = [
  "발바닥지압판",
  "발지압판",
  "발바닥",
  "지압발판",
  "발바닥마사지기",
  "발지압",
  "발마사지기",
  "발바닥안마기",
  "지압",
  "발판",
];

test("확장 재료가 없어도 FINAL 키워드는 유지하고 145개 긴 상품명 재고를 우선 생성한다", () => {
  const result = generateFinalKeywordOnlySeoTitleInventory({
    finalKeywords: KEYWORDS,
    rounds: 5,
  });

  assert.equal(result.targetCount, 145);
  assert.equal(result.generatedCount, 145);
  assert.equal(
    new Set(result.candidates.map((row) => row.titleFingerprint)).size,
    145,
  );
  assert.ok(
    result.warnings.includes(
      "SEO_TITLE_INVENTORY_SOURCE:LONG_TITLE_PRIORITY_V6_FINAL_FALLBACK",
    ),
  );
  assert.equal(result.expansionMaterialCount, 0);

  const allowed = new Set(KEYWORDS.map(keywordElonSeoCanonical));
  let recommended = 0;
  let totalBytes = 0;
  for (const candidate of result.candidates) {
    const bytes = keywordElonSeoUtf8Bytes(candidate.title);
    totalBytes += bytes;
    if (bytes >= 40) recommended += 1;
    assert.ok(bytes >= 30, `${bytes}B ${candidate.title}`);
    assert.ok(bytes <= 50, `${bytes}B ${candidate.title}`);
    assert.ok(candidate.sourceMaterials.length >= 2, candidate.title);
    assert.equal(
      candidate.sourceMaterials.every((material) =>
        allowed.has(keywordElonSeoCanonical(material)),
      ),
      true,
      candidate.title,
    );
    assert.doesNotMatch(
      candidate.title,
      /윤지선작업|통합|예지|공지|하단공지|PVC|색상랜덤|발송/,
    );
    assert.equal(
      candidate.metadata.strategy,
      "long-title-priority-v6-final-fallback",
    );
  }
  assert.ok(recommended >= 100, `recommended=${recommended}`);
  assert.ok(totalBytes / result.candidates.length >= 40, `average=${totalBytes / result.candidates.length}`);
});

test("기존 사용 상품명 fingerprint는 다음 재고에서 재사용하지 않는다", () => {
  const first = generateFinalKeywordOnlySeoTitleInventory({
    finalKeywords: KEYWORDS,
    rounds: 1,
  });
  const issued = first.candidates
    .slice(0, 10)
    .map((row) => row.titleFingerprint);
  const second = generateFinalKeywordOnlySeoTitleInventory({
    finalKeywords: KEYWORDS,
    rounds: 1,
    existingTitleFingerprints: issued,
  });
  const issuedSet = new Set(issued);
  assert.equal(
    second.candidates.some((row) => issuedSet.has(row.titleFingerprint)),
    false,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { PRODUCT_GROUP_MARKET_REGISTRY } from "../src/lib/productGroupMarketRegistry.ts";
import {
  buildKeywordElonSeoPackage,
  KEYWORD_ELON_SEO_FORBIDDEN_TERMS,
  keywordElonSeoCanonical,
} from "../src/lib/keywordEngineElonLabSeoOutput.ts";

function candidate(keyword, relevance, qualityScore, totalSearch) {
  return {
    keyword,
    searchKey: keywordElonSeoCanonical(keyword),
    searchKeyword: keywordElonSeoCanonical(keyword),
    relevance,
    shoppingIntent: 90,
    specificity: 80,
    qualityScore,
    totalSearch,
  };
}

function identity() {
  return {
    koreanProductIdentity: "코 보정용 일회용 테이프",
    coreProduct: "코 보정 테이프",
    identityAnchor: "콧볼 콧구멍 보정용 붙이는 테이프",
    primarySeeds: ["코보정테이프", "콧볼축소테이프", "코모양보정패치"],
    conditionalSeeds: ["일회용코패치", "재단가능코테이프", "붙이는코스티커"],
    functionModifiers: ["콧볼 축소", "콧구멍 보정", "모양 유지"],
    designShapeModifiers: ["슬림 스트립형", "스티커형"],
    specAttributes: ["일회용", "재단 가능", "61x11mm"],
  };
}

const candidates = [
  candidate("콧볼축소", 95, 81.1, 6760),
  candidate("코보정테이프", 95, 80.5, 6180),
  candidate("코테이프", 94, 79.4, 5600),
  candidate("콧구멍보정", 93, 78.2, 4200),
  candidate("코모양보정", 92, 77.5, 3100),
  candidate("붙이는테이프", 91, 76.8, 2500),
  candidate("일회용코패치", 91, 75.9, 1900),
  candidate("콧대보정", 90, 74.4, 1500),
  candidate("코스티커", 90, 73.8, 1200),
  candidate("코교정패치", 90, 72.9, 900),
  candidate("슬림코테이프", 90, 71.8, 700),
  candidate("재단코테이프", 90, 70.4, 500),
  candidate("도매코테이프", 99, 99, 100000),
  candidate("대량납품테이프", 99, 99, 100000),
];

const allowedKeys = candidates.map((row) => row.searchKey);

test("SEO output produces 29 mall titles and exactly ten common keywords", () => {
  const output = buildKeywordElonSeoPackage(
    {
      identity: identity(),
      candidates,
      allowedKeys,
      blockedKeys: [],
      customBlockedTerms: [],
      titleResult: {
        title: "코 보정용 일회용 테이프 콧볼축소 붙이는 스티커",
        usedKeywords: ["콧볼축소", "코보정테이프", "붙이는테이프"],
      },
    },
    PRODUCT_GROUP_MARKET_REGISTRY,
  );

  assert.equal(output.status, "ready");
  assert.equal(output.commonSearchKeywords.length, 10);
  assert.equal(output.mallTitles.length, 29);
  assert.deepEqual(
    Object.fromEntries(
      ["도매1", "도매2", "도매3", "도매4", "소매1", "소매2"].map((group) => [
        group,
        output.mallTitles.filter((row) => row.productGroup === group).length,
      ]),
    ),
    { 도매1: 5, 도매2: 3, 도매3: 3, 도매4: 1, 소매1: 12, 소매2: 5 },
  );
  assert.equal(output.commonSearchKeywords.every((keyword) => !/\s/.test(keyword)), true);
  assert.equal(output.mallTitles.every((row) => row.byteLength <= 100), true);
  assert.ok(output.uniqueTitleCount >= 20);

  for (const forbidden of KEYWORD_ELON_SEO_FORBIDDEN_TERMS) {
    assert.equal(output.commonSearchKeywords.some((keyword) => keyword.includes(forbidden)), false);
    assert.equal(output.mallTitles.some((row) => row.title.includes(forbidden)), false);
  }
  const core = keywordElonSeoCanonical(identity().coreProduct);
  assert.equal(
    output.mallTitles.every((row) => keywordElonSeoCanonical(row.title).includes(core)),
    true,
  );
});

test("SEO output fills a narrow STEP 4 result from source-grounded materials without forbidden terms", () => {
  const narrowCandidates = candidates.slice(0, 4);
  const output = buildKeywordElonSeoPackage(
    {
      identity: {
        ...identity(),
        conditionalSeeds: [...identity().conditionalSeeds, "도매 전용", "대량 납품"],
      },
      candidates: narrowCandidates,
      allowedKeys: narrowCandidates.map((row) => row.searchKey),
      blockedKeys: ["코교정"],
      customBlockedTerms: ["의료기기"],
      titleResult: { usedKeywords: ["콧볼축소", "코보정테이프"] },
    },
    PRODUCT_GROUP_MARKET_REGISTRY,
  );

  assert.equal(output.commonSearchKeywords.length, 10);
  assert.ok(output.generatedFallbackKeywordCount > 0);
  assert.ok(output.warnings.some((warning) => warning.includes("보완")));
  assert.equal(output.commonSearchKeywords.some((keyword) => /도매|대량|납품|의료기기|코교정/.test(keyword)), false);
  assert.equal(output.mallTitles.some((row) => /도매|대량|납품|의료기기|코교정/.test(row.title)), false);
});

test("keyword lab SEO output remains preview-only and does not call external apply routes", () => {
  const component = readFileSync(
    "src/app/keyword-engine-elon-lab/KeywordElonShoplingSeoOutput.tsx",
    "utf8",
  );
  assert.match(component, /SEO OUTPUT · PREVIEW ONLY/);
  assert.match(component, /아무것도 쓰지 않습니다/);
  assert.doesNotMatch(component, /fetch\s*\(/);
  assert.doesNotMatch(component, /dispatchKeyword|keyword-shopling-direct-apply|shopling-upload/);
});

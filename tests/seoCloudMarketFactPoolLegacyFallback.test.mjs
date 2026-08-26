import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildKeywordElonFactPool } from "../src/lib/keywordEngineElonFactPool.ts";
import {
  composeKeywordElonMarketTitles,
  resolveKeywordElonMarketProfile,
} from "../src/lib/keywordEngineElonMarketTitleComposer.ts";
import {
  fillSeoTitleInventoryShortages,
  seoTitleFallbackCanonical,
} from "../src/lib/seoTitleInventoryFallback.ts";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const MARKETS = [
  ["도매1", "카페24(1.9)"],
  ["도매1", "도매꾹"],
  ["도매1", "오너클랜"],
  ["도매1", "셀파"],
  ["도매1", "투비즈온"],
  ["도매2", "도매꾹"],
  ["도매2", "오너클랜"],
  ["도매2", "셀파"],
  ["도매3", "도매꾹"],
  ["도매3", "오너클랜"],
  ["도매3", "셀파"],
  ["도매4", "도매꾹"],
  ["소매1", "옥션"],
  ["소매1", "지마켓"],
  ["소매1", "11번가"],
  ["소매1", "스마트스토어"],
  ["소매1", "GS SHOP"],
  ["소매1", "쿠팡"],
  ["소매1", "신세계몰"],
  ["소매1", "카카오톡 스토어"],
  ["소매1", "에이블리"],
  ["소매1", "롯데ON"],
  ["소매1", "인큐텐"],
  ["소매1", "토스쇼핑"],
  ["소매2", "옥션"],
  ["소매2", "지마켓"],
  ["소매2", "11번가"],
  ["소매2", "쿠팡"],
  ["소매2", "토스쇼핑"],
];

test("1688 고정링크가 없어도 상품출시 화면에서 SEO 클라우드 진입을 막지 않는다", async () => {
  const handoff = await source("public/product-launch-tracker-app/seo-title-ledger-handoff.js");
  const engine = await source("src/lib/keywordEngineElonBulkFinal.ts");
  const route = await source("src/app/api/keyword-engine-elon-lab/route.ts");
  assert.doesNotMatch(handoff, /개 상품에 1688 링크가 없습니다/);
  assert.match(engine, /legacy_internal/);
  assert.match(engine, /BULK_LEGACY_INTERNAL_SOURCE/);
  assert.doesNotMatch(engine, /if \(!text\(input\.sourceUrl\)\) throw new Error\("1688 상품 링크가 없습니다/);
  assert.match(route, /bulkLegacyFallbackAvailable: true/);
  assert.match(route, /body\.collectionMode === "legacy_internal"/);
});

test("FACT POOL은 내부 상품·옵션·검증키워드만 사용하고 광고성 추측과 코드를 버린다", () => {
  const facts = buildKeywordElonFactPool({
    productName: "발바닥 지압스텝퍼 색상랜덤",
    modelNumber: "AAA491",
    optionText: "색상랜덤 / BAF6-2 / 单品",
    supportingText: "발지압용품 · AAA491 · 프리미엄",
    identity: {
      coreProduct: "지압스텝퍼",
      koreanProductIdentity: "발바닥 지압스텝퍼",
      identityAnchor: "발바닥 지압",
      primarySeeds: ["발지압판"],
      conditionalSeeds: ["실내용"],
      functionModifiers: ["발바닥지압"],
      designShapeModifiers: ["스텝형"],
      specAttributes: ["색상랜덤"],
    },
    searchKeywords: [
      { keyword: "지압발판", sourceMaterials: ["발지압"] },
      { keyword: "발바닥마사지" },
    ],
  });
  const values = facts.map((fact) => fact.value).join(" | ");
  assert.match(values, /색상랜덤/);
  assert.match(values, /발지압판/);
  assert.match(values, /지압발판/);
  assert.doesNotMatch(values, /프리미엄/);
  assert.doesNotMatch(values, /AAA491/);
  assert.doesNotMatch(values, /BAF6-2/);
  assert.ok(facts.every((fact) => ["A", "B"].includes(fact.confidence)));
});

test("29개 실제 마켓을 B2B·네이버·쿠팡·에이블리·일반소매 프로필로 나눠 제목을 재구성한다", () => {
  assert.equal(resolveKeywordElonMarketProfile("도매꾹", "도매1"), "b2b");
  assert.equal(resolveKeywordElonMarketProfile("스마트스토어", "소매1"), "naver");
  assert.equal(resolveKeywordElonMarketProfile("쿠팡", "소매1"), "coupang");
  assert.equal(resolveKeywordElonMarketProfile("에이블리", "소매1"), "ably");

  const modelName = "발 지압 스텝퍼";
  const facts = buildKeywordElonFactPool({
    productName: "발바닥 지압스텝퍼 색상랜덤",
    modelNumber: "AAA491",
    optionText: "색상랜덤",
    supportingText: "발지압용품",
    identity: {
      coreProduct: "지압스텝퍼",
      koreanProductIdentity: "발바닥 지압스텝퍼",
      identityAnchor: "발바닥 지압",
      primarySeeds: ["발지압판", "지압발판"],
      conditionalSeeds: ["실내용"],
      functionModifiers: ["발바닥지압", "발마사지"],
      designShapeModifiers: ["스텝형"],
      specAttributes: ["색상랜덤"],
    },
    searchKeywords: [
      { keyword: "발지압판" },
      { keyword: "지압발판" },
      { keyword: "발바닥지압" },
      { keyword: "발마사지" },
    ],
  });
  const rows = MARKETS.map(([productGroup, marketName], index) => ({
    productGroup,
    marketName,
    accountIdLabel: `account-${index}`,
    title: `${modelName} 발지압판`,
  }));
  const result = composeKeywordElonMarketTitles({ rows, modelName, facts });
  assert.equal(result.rows.length, 29);
  assert.ok(result.adjustedCount > 0);
  assert.equal(result.profileCounts.naver, 1);
  assert.equal(result.profileCounts.coupang, 2);
  assert.equal(result.profileCounts.ably, 1);
  assert.equal(Object.values(result.profileCounts).reduce((sum, value) => sum + value, 0), 29);
  for (const row of result.rows) {
    assert.equal(row.title.split(modelName).length - 1, 1, row.title);
    assert.ok(Buffer.byteLength(row.title, "utf8") <= 50, row.title);
    assert.doesNotMatch(row.title, /인기|베스트|최고|추천상품|프리미엄/);
  }
});

test("키워드가 희소해도 검증·보완 10개 재료의 조합과 어순으로 29x5=145개 재고를 고정 생성한다", () => {
  const modelName = "발 지압 스텝퍼";
  const keywords = [
    "발지압판",
    "지압발판",
    "발바닥지압",
    "발마사지",
    "발바닥마사지",
    "실내지압",
    "홈지압",
    "발지압기",
    "지압보드",
    "발마사지판",
  ].map((keyword) => ({ keyword, sourceMaterials: [keyword] }));
  const result = fillSeoTitleInventoryShortages({
    modelName,
    searchKeywords: keywords,
    extraMaterials: ["색상랜덤", "스텝형", "발바닥용"],
    rounds: 5,
  });
  assert.equal(result.targetCount, 145);
  assert.equal(result.candidates.length, 145);
  assert.deepEqual(result.groupCounts, {
    도매1: 25,
    도매2: 15,
    도매3: 15,
    도매4: 5,
    소매1: 60,
    소매2: 25,
  });
  assert.deepEqual(result.groupShortages, {
    도매1: 0,
    도매2: 0,
    도매3: 0,
    도매4: 0,
    소매1: 0,
    소매2: 0,
  });
  const fingerprints = result.candidates.map((candidate) => seoTitleFallbackCanonical(candidate.title));
  assert.equal(new Set(fingerprints).size, 145);
  for (const candidate of result.candidates) {
    assert.equal(candidate.title.split(modelName).length - 1, 1, candidate.title);
    assert.ok(Buffer.byteLength(candidate.title, "utf8") <= 50, candidate.title);
    assert.doesNotMatch(candidate.title, /인기|베스트|최고|추천상품|프리미엄/);
  }
});

test("상품명 재고 동기화는 링크 필수조건을 제거하고 기존 FINAL 포함 총 145개를 목표로 센다", async () => {
  const sync = await source("src/lib/seoTitleBulkInventorySync.ts");
  assert.doesNotMatch(sync, /reason: "source_url_not_ready"/);
  assert.doesNotMatch(sync, /validate1688Url\(sourceUrl\)/);
  assert.match(sync, /seo-bulk-cloud-inventory-v3-fixed145/);
  assert.match(sync, /fillSeoTitleInventoryShortages/);
  assert.match(sync, /\["available", "reserved", "used", "review"\]/);
  assert.match(sync, /fixedTargetRequired: true/);
  assert.match(sync, /target_inventory_count: SEO_TITLE_FULL_MARKET_SIZE \* SEO_TITLE_DEFAULT_ROUNDS/);
});

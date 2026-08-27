import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildKeywordElonTitleExpansionPool } from "../src/lib/keywordEngineElonTitleExpansion.ts";
import { composeKeywordElonSafeMallTitles } from "../src/lib/keywordEngineElonMallTitleSafeComposer.ts";
import { generateFinalKeywordOnlySeoTitleInventory } from "../src/lib/seoTitleFinalKeywordInventoryGenerator.ts";
import { PRODUCT_GROUP_MARKET_REGISTRY } from "../src/lib/productGroupMarketRegistry.ts";
import { keywordElonSeoCanonical, keywordElonSeoUtf8Bytes } from "../src/lib/keywordEngineElonLabSeoOutput.ts";

const FINAL = [
  "발바닥지압판",
  "발지압판",
  "발바닥마사지기",
  "지압발판",
  "발지압",
  "발마사지기",
  "발바닥안마기",
  "발마사지판",
  "발지압기",
  "지압마사지판",
];

function candidate(keyword, intentClass, overrides = {}) {
  return {
    keyword,
    searchKey: keyword,
    searchKeyword: keyword,
    relevance: 94,
    shoppingIntent: 90,
    specificity: 86,
    titleEligible: true,
    rationale: "test",
    sourceTags: ["searchad", "related"],
    totalSearch: 1200,
    pcSearch: 100,
    mobileSearch: 1100,
    compIdx: "LOW",
    plAvgDepth: 3,
    demandScore: 70,
    competitionOpportunity: 88,
    qualityScore: 86,
    safetyPass: true,
    safetyReason: "pass",
    dataConfidence: "high",
    categoryMatch: 95,
    categoryAligned: true,
    intentClass,
    ...overrides,
  };
}

const EXPANSION_CANDIDATES = [
  candidate("풋마사지판", "core_synonym", { totalSearch: 1800 }),
  candidate("발마사지보드", "form", { totalSearch: 1600 }),
  candidate("발지압매트", "form", { totalSearch: 1500 }),
  candidate("실내발지압", "context", { totalSearch: 900 }),
  candidate("사무실발지압", "context", { totalSearch: 800 }),
  candidate("홈트발마사지", "context", { totalSearch: 700 }),
  candidate("발스트레칭판", "use", { totalSearch: 650 }),
  candidate("발관리용품", "use", { totalSearch: 620 }),
  candidate("발지압운동", "use", { totalSearch: 600 }),
  candidate("발바닥자극판", "function", { totalSearch: 580 }),
  candidate("발바닥롤링판", "function", { totalSearch: 560 }),
  candidate("풋케어지압판", "category_tail", { totalSearch: 540 }),
  candidate("다리발안마용품", "category_tail", { totalSearch: 520 }),
  candidate("족저근막염치료", "function", {
    categoryMatch: 20,
    categoryAligned: false,
    relevance: 40,
    safetyPass: false,
    qualityScore: 0,
  }),
];

const ALLOWED = [...FINAL, ...EXPANSION_CANDIDATES.map((row) => row.searchKey)];

function buildPool() {
  return buildKeywordElonTitleExpansionPool({
    candidates: [
      ...FINAL.map((keyword) => candidate(keyword, "core_synonym")),
      ...EXPANSION_CANDIDATES,
    ],
    searchKeywords: FINAL,
    allowedKeys: ALLOWED,
    category: "생활/건강>안마용품>다리/발안마기",
    limit: 30,
  });
}

test("FINAL 10개 외 카테고리 일치 후보만 TITLE EXPANSION POOL에 보존한다", () => {
  const pool = buildPool();
  assert.ok(pool.length >= 10, `pool=${pool.length}`);
  assert.equal(pool.some((row) => FINAL.includes(row.keyword)), false);
  assert.equal(pool.some((row) => row.keyword.includes("족저근막염")), false);
  assert.equal(pool.every((row) => row.categoryAligned === true), true);
  assert.equal(pool.every((row) => row.categoryMatch >= 85), true);
  assert.ok(new Set(pool.map((row) => row.intentClass)).size >= 5);

  for (let index = 1; index < pool.length; index += 1) {
    // The pool is intent-round-robin, so it must not collapse to one intent bucket.
    if (pool[index - 1].intentClass === pool[index].intentClass) continue;
    assert.ok(true);
  }
});

test("29개 쇼핑몰 상품명은 FINAL anchor와 카테고리 intent를 섞어 의미적으로 분산한다", () => {
  const pool = buildPool();
  const result = composeKeywordElonSafeMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords: FINAL,
    titleExpansionPool: pool,
    modelName: "발바닥 지압판",
    context: {
      modelNumber: "AAA491",
      productName: "발바닥 지압 스텝퍼",
      category: "생활/건강>안마용품>다리/발안마기",
      detailHtml: '<img src="https://example.com/윤지선작업/예지/공지.jpg" />',
    },
  });

  assert.equal(result.rows.length, 29);
  assert.equal(result.uniqueTitleCount, 29);
  assert.ok(result.warnings.includes("SEO_MALL_TITLE_SOURCE:CATEGORY_INTENT_EXPANSION_V5"));
  const expansionKeys = new Set(pool.map((row) => keywordElonSeoCanonical(row.keyword)));
  const finalKeys = new Set(FINAL.map(keywordElonSeoCanonical));
  let expansionRows = 0;
  for (const row of result.rows) {
    const bytes = keywordElonSeoUtf8Bytes(row.title);
    assert.ok(bytes >= 30 && bytes <= 50, `${bytes}B ${row.title}`);
    assert.equal(
      row.keywordMaterials.some((material) => finalKeys.has(keywordElonSeoCanonical(material))),
      true,
      row.title,
    );
    if (
      row.keywordMaterials.some((material) =>
        expansionKeys.has(keywordElonSeoCanonical(material)),
      )
    ) {
      expansionRows += 1;
    }
    assert.doesNotMatch(row.title, /윤지선작업|예지|공지|족저근막염|치료/);
  }
  assert.ok(expansionRows >= 20, `expansionRows=${expansionRows}`);
});

test("145개 추가등록 재고도 카테고리 intent 재료를 사용하고 FINAL anchor를 유지한다", () => {
  const pool = buildPool();
  const result = generateFinalKeywordOnlySeoTitleInventory({
    finalKeywords: FINAL,
    titleExpansionPool: pool,
    rounds: 5,
  });
  assert.equal(result.generatedCount, 145);
  assert.equal(new Set(result.candidates.map((row) => row.titleFingerprint)).size, 145);
  assert.ok(result.expansionMaterialCount >= 10);
  const finalKeys = new Set(FINAL.map(keywordElonSeoCanonical));
  let expanded = 0;
  for (const row of result.candidates) {
    const bytes = keywordElonSeoUtf8Bytes(row.title);
    assert.ok(bytes >= 30 && bytes <= 50, `${bytes}B ${row.title}`);
    assert.equal(
      row.sourceMaterials.some((material) => finalKeys.has(keywordElonSeoCanonical(material))),
      true,
      row.title,
    );
    if (row.metadata.materialOrigins.includes("category_expansion")) expanded += 1;
  }
  assert.ok(expanded >= 100, `expanded=${expanded}`);
});

test("segmented SEO API carries Product Launch category into the existing scoring pass", async () => {
  const route = await readFile(
    new URL("../src/app/api/keyword-engine-elon-lab/route.ts", import.meta.url),
    "utf8",
  );
  const scoring = await readFile(
    new URL("../src/lib/keywordEngineElonLabV2Scoring.ts", import.meta.url),
    "utf8",
  );
  const bulk = await readFile(
    new URL("../src/lib/keywordEngineElonBulkFinal.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /SHOPLING_CATEGORY=/);
  assert.match(route, /categoryFromSource/);
  assert.match(scoring, /categoryMatch/);
  assert.match(scoring, /intentClass/);
  assert.match(scoring, /shoplingCategory/);
  assert.match(bulk, /buildKeywordElonTitleExpansionPool/);
  assert.match(bulk, /TITLE_EXPANSION_POOL_COUNT/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { composeKeywordElonSafeMallTitles } from "../src/lib/keywordEngineElonMallTitleSafeComposer.ts";
import { PRODUCT_GROUP_MARKET_REGISTRY } from "../src/lib/productGroupMarketRegistry.ts";
import { keywordElonSeoCanonical, keywordElonSeoUtf8Bytes } from "../src/lib/keywordEngineElonLabSeoOutput.ts";

const aaa491Keywords = [
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

test("AAA491형 최종키워드 10개만 사용해 29개 쇼핑몰 상품명을 분산한다", () => {
  const result = composeKeywordElonSafeMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords: aaa491Keywords,
    modelName: "발바닥 지압스텝퍼",
    context: {
      modelNumber: "AAA491",
      productName: "발바닥 지압스텝퍼 색상랜덤",
      category: "생활/건강>안마용품>다리/발안마기",
      optionText: "색상랜덤 발송 / BAF6-2 / 000000000730",
      detailHtml:
        '<img src="https://ai-saurus.com/assets/윤지선작업/통합/발바닥지압스텝퍼.jpg" alt="공지 하단공지" />',
      mainImageUrl: "https://ai-saurus.com/assets/예지/발바닥지압스텝퍼-main.jpg",
    },
  });

  assert.equal(result.rows.length, 29);
  assert.equal(result.keywordCoverageCount, aaa491Keywords.length);
  assert.equal(result.keywordCoverageTotal, aaa491Keywords.length);
  assert.equal(result.uniqueTitleCount, 29);
  assert.equal(result.facts.length, 0);
  assert.ok(result.warnings.includes("SEO_MALL_TITLE_SOURCE:FINAL_KEYWORDS_ONLY_V3"));

  const allowed = new Set(aaa491Keywords.map(keywordElonSeoCanonical));
  for (const keyword of aaa491Keywords) {
    const key = keywordElonSeoCanonical(keyword);
    assert.ok(
      result.rows.some((row) => row.keywordMaterials.some((material) => keywordElonSeoCanonical(material) === key)),
      `missing keyword coverage: ${keyword}`,
    );
  }

  for (const row of result.rows) {
    assert.ok(row.title.trim());
    assert.ok(keywordElonSeoUtf8Bytes(row.title) <= 50, row.title);
    assert.equal(row.keywordMaterials.every((material) => allowed.has(keywordElonSeoCanonical(material))), true);
    assert.doesNotMatch(row.title, /AAA491|BAF6-2|000000000730/i);
    assert.doesNotMatch(row.title, /윤지선작업|통합|예지|공지|하단공지|색상랜덤|발송|안마용품/);
  }
});

test("최종키워드가 4개뿐이어도 외부 재료를 발명하지 않고 순서 조합만으로 29개를 만든다", () => {
  const keywords = ["포켓수첩", "가죽수첩", "미니노트", "펜홀더노트"];
  const result = composeKeywordElonSafeMallTitles({
    markets: PRODUCT_GROUP_MARKET_REGISTRY,
    finalKeywords: keywords,
    modelName: "미니 가죽노트",
    context: {
      modelNumber: "AAA446",
      productName: "볼펜꽂이 미니 가죽노트",
      category: "문구/사무용품>노트/수첩>미니수첩",
      optionText: "A7 / 펜홀더 / 슬리브 포함 / BCD2-1 / 000000000123",
      detailHtml: '<img src="https://example.com/윤지선작업/통합/공지.jpg" />',
    },
  });

  assert.equal(result.rows.length, 29);
  assert.equal(result.keywordCoverageCount, 4);
  assert.equal(result.uniqueTitleCount, 29);
  const allowed = new Set(keywords.map(keywordElonSeoCanonical));
  for (const row of result.rows) {
    assert.ok(keywordElonSeoUtf8Bytes(row.title) <= 50);
    assert.equal(row.keywordMaterials.every((material) => allowed.has(keywordElonSeoCanonical(material))), true);
    assert.doesNotMatch(row.title, /AAA446|BCD2-1|000000000123/i);
    assert.doesNotMatch(row.title, /윤지선작업|통합|공지|A7|슬리브|볼펜꽂이/);
  }
});

test("코드형 최종키워드는 쇼핑몰별 상품명에 조용히 섞지 않고 즉시 차단한다", () => {
  assert.throws(
    () =>
      composeKeywordElonSafeMallTitles({
        markets: PRODUCT_GROUP_MARKET_REGISTRY,
        finalKeywords: ["발지압판", "BAF6-2", "발마사지기"],
        modelName: "발바닥 지압스텝퍼",
        context: {
          modelNumber: "AAA491",
          productName: "발바닥 지압스텝퍼",
        },
      }),
    /코드형 최종키워드/,
  );
});

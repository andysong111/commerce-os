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

test("AAA491형 최종키워드 10개를 모두 쓰면서 29개 쇼핑몰 상품명을 안전하게 분산한다", () => {
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
        '<img src="https://ai-saurus.com/assets/발바닥지압스텝퍼.jpg" alt="跨境脚底穴位按摩器充气指压板" />',
      mainImageUrl: "https://ai-saurus.com/assets/발바닥지압스텝퍼-main.jpg",
    },
  });

  assert.equal(result.rows.length, 29);
  assert.equal(result.keywordCoverageCount, aaa491Keywords.length);
  assert.equal(result.keywordCoverageTotal, aaa491Keywords.length);
  assert.equal(result.uniqueTitleCount, 29);

  for (const keyword of aaa491Keywords) {
    const key = keywordElonSeoCanonical(keyword);
    assert.ok(
      result.rows.some((row) => keywordElonSeoCanonical(row.title).includes(key)),
      `missing keyword coverage: ${keyword}`,
    );
  }

  for (const row of result.rows) {
    assert.ok(row.title.trim());
    assert.ok(keywordElonSeoUtf8Bytes(row.title) <= 50, row.title);
    assert.doesNotMatch(row.title, /AAA491/i);
    assert.doesNotMatch(row.title, /BAF6-2/i);
    assert.doesNotMatch(row.title, /000000000730/);
    assert.doesNotMatch(row.title, /쿠팡|스마트스토어|지마켓|옥션|도매꾹/);
    assert.doesNotMatch(row.title, /발바닥지압스텝퍼발지압용스텝퍼발마사지발판/);
  }
});

test("최종키워드가 4개뿐이어도 새 검색키워드를 발명하지 않고 SAFE FACT와 어순으로 29개를 만든다", () => {
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
      detailHtml: '<img src="https://example.com/미니가죽노트/펜홀더슬리브.jpg" />',
    },
  });

  assert.equal(result.rows.length, 29);
  assert.equal(result.keywordCoverageCount, 4);
  assert.ok(result.uniqueTitleCount >= 24, `unique=${result.uniqueTitleCount}`);
  for (const row of result.rows) {
    assert.ok(keywordElonSeoUtf8Bytes(row.title) <= 50);
    assert.doesNotMatch(row.title, /AAA446|BCD2-1|000000000123/i);
    assert.doesNotMatch(row.title, /a7가죽포켓수첩펜홀더슬리브포함/i);
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

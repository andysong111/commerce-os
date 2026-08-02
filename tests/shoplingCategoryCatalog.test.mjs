import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  inferShoplingCategoryIntent,
  inferShoplingCoreProductTerms,
  parseProductCategoryInputs,
  scoreShoplingCategoryCandidate,
  shortlistShoplingCategories,
} from "../src/lib/shoplingCategoryScoring.ts";

test("미니짐볼 상품은 핵심명사 짐볼을 찾아 가구·도서보다 헬스 카테고리를 우선한다", () => {
  const categories = [
    {
      depth: 4,
      path: "스포츠/레저>헬스기구>스트레칭용품>짐볼",
      names: ["스포츠/레저", "헬스기구", "스트레칭용품", "짐볼"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "가구/인테리어>거실가구>소파>1인용소파",
      names: ["가구/인테리어", "거실가구", "소파", "1인용소파"],
      codes: ["2", "22", "222", "2222"],
    },
    {
      depth: 4,
      path: "도서>건강/취미>운동>요가",
      names: ["도서", "건강/취미", "운동", "요가"],
      codes: ["3", "33", "333", "3333"],
    },
  ];
  const input = {
    itemId: "item-1",
    modelNumber: "AAA492",
    productName: "미니짐볼 300g 색상랜덤",
    optionLabels: ["단품"],
    currentCategory: "",
    chinaProductLinks: [],
  };
  assert.deepEqual(inferShoplingCoreProductTerms(input, categories), ["짐볼"]);
  const shortlist = shortlistShoplingCategories(input, categories, 10);
  assert.equal(shortlist[0].path, categories[0].path);
  assert.ok(
    scoreShoplingCategoryCandidate("미니짐볼", categories[0].path) >
      scoreShoplingCategoryCandidate("미니짐볼", categories[1].path),
  );
});

test("투구골무는 마지막 핵심명사 골무를 우선하고 의류·타이즈 후보를 차단한다", () => {
  const categories = [
    {
      depth: 4,
      path: "의류>언더웨어/잠옷>여성 내의>여성 타이즈",
      names: ["의류", "언더웨어/잠옷", "여성 내의", "여성 타이즈"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "생활/건강>수예>재봉용품>골무",
      names: ["생활/건강", "수예", "재봉용품", "골무"],
      codes: ["2", "22", "222", "2222"],
    },
    {
      depth: 4,
      path: "생활/건강>수예>바느질용품>기타수예용품",
      names: ["생활/건강", "수예", "바느질용품", "기타수예용품"],
      codes: ["3", "33", "333", "3333"],
    },
    {
      depth: 4,
      path: "스포츠/레저>축구>보호용품>축구 골키퍼장갑",
      names: ["스포츠/레저", "축구", "보호용품", "축구 골키퍼장갑"],
      codes: ["4", "44", "444", "4444"],
    },
  ];
  const input = {
    itemId: "item-15",
    modelNumber: "AAA015",
    productName: "투구골무",
    optionLabels: ["투구 골무 S사이즈", "투구 골무 M사이즈"],
    currentCategory: "",
    chinaProductLinks: [],
  };
  const intent = inferShoplingCategoryIntent(input);
  assert.equal(intent?.coreTerm, "골무");
  assert.deepEqual(inferShoplingCoreProductTerms(input, categories), ["골무"]);
  const shortlist = shortlistShoplingCategories(input, categories, 10);
  assert.equal(shortlist[0].path, "생활/건강>수예>재봉용품>골무");
  assert.ok(shortlist.every((candidate) => !/타이즈|의류|축구/.test(candidate.path)));
  assert.ok(shortlist.every((candidate) => candidate.intentMatched === true));
});

test("골무 관련 카테고리가 없으면 의류 후보로 되돌아가지 않는다", () => {
  const categories = [
    {
      depth: 4,
      path: "의류>언더웨어/잠옷>여성 내의>여성 타이즈",
      names: ["의류", "언더웨어/잠옷", "여성 내의", "여성 타이즈"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "스포츠/레저>축구>보호용품>축구장갑",
      names: ["스포츠/레저", "축구", "보호용품", "축구장갑"],
      codes: ["2", "22", "222", "2222"],
    },
  ];
  const input = {
    itemId: "item-15",
    modelNumber: "AAA015",
    productName: "투구골무",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };
  assert.deepEqual(shortlistShoplingCategories(input, categories, 10), []);
});

test("AI 카테고리 입력은 상품 ID·모델명과 최대 처리 수를 검증한다", () => {
  assert.deepEqual(
    parseProductCategoryInputs({
      items: [
        {
          itemId: "item-1",
          modelNumber: "AAA492",
          productName: "미니짐볼",
          optionLabels: ["핑크", "블루"],
          currentCategory: "",
          chinaProductLinks: ["https://detail.1688.com/offer/1.html"],
        },
      ],
    }),
    [
      {
        itemId: "item-1",
        modelNumber: "AAA492",
        productName: "미니짐볼",
        optionLabels: ["핑크", "블루"],
        currentCategory: "",
        chinaProductLinks: ["https://detail.1688.com/offer/1.html"],
      },
    ],
  );
  assert.throws(() => parseProductCategoryInputs({ items: [] }), /선택하세요/);
  assert.throws(
    () =>
      parseProductCategoryInputs({
        items: Array.from({ length: 26 }, (_, index) => ({
          itemId: `item-${index}`,
          productName: "상품",
        })),
      }),
    /최대 25개/,
  );
});

test("진행관리 UI는 카테고리 최신화·AI 자동설정·수동 로그인 상태를 포함한다", async () => {
  const source = await readFile(
    new URL(
      "../public/product-launch-tracker-app/category-ai.js",
      import.meta.url,
    ),
    "utf8",
  );
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /샵플링 카테고리 최신화/);
  assert.match(source, /선택 AI 카테고리 자동설정/);
  assert.match(source, /manual_login_required/);
  assert.match(source, /categoryAiSuggestion/);
  assert.match(source, /기존값 유지/);
  assert.match(app, /category-ai\.js/);
});

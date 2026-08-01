import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseProductCategoryInputs,
  scoreShoplingCategoryCandidate,
  shortlistShoplingCategories,
} from "../src/lib/shoplingCategoryScoring.ts";

test("미니짐볼 상품은 가구·도서보다 헬스 짐볼 카테고리가 우선된다", () => {
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
  const shortlist = shortlistShoplingCategories(input, categories, 10);
  assert.equal(shortlist[0].path, categories[0].path);
  assert.ok(
    scoreShoplingCategoryCandidate("미니짐볼", categories[0].path) >
      scoreShoplingCategoryCandidate("미니짐볼", categories[1].path),
  );
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

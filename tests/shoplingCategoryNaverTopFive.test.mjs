import assert from "node:assert/strict";
import test from "node:test";

import { matchNaverTopFiveCategoryPathsToShopling } from "../src/lib/shoplingCategoryNaverTopFive.ts";

test("네이버 상위 5개 상품의 반복 카테고리를 다수 근거로 반영한다", () => {
  const categories = [
    { path: "생활/건강 > 욕실용품 > 샤워기" },
    { path: "생활/건강 > 욕실용품 > 변기솔" },
  ];

  const matches = matchNaverTopFiveCategoryPathsToShopling(
    [
      "생활/건강 > 욕실용품 > 샤워기",
      "생활/건강 > 욕실용품 > 샤워기",
      "생활/건강 > 욕실용품 > 샤워기",
      "생활/건강 > 욕실용품 > 변기솔",
      "생활/건강 > 욕실용품 > 샤워기",
    ],
    categories,
  );

  assert.equal(matches[0]?.path, "생활/건강 > 욕실용품 > 샤워기");
  assert.equal(matches[0]?.supportCount, 4);
  assert.ok((matches[0]?.score ?? 0) > (matches[1]?.score ?? 0));
});

test("상위 결과 하나의 우연한 완전일치보다 여러 상품의 공통 카테고리를 우선한다", () => {
  const categories = [
    { path: "생활/건강 > 욕실용품 > 샤워기" },
    { path: "생활/건강 > 욕실용품 > 변기솔" },
  ];

  const matches = matchNaverTopFiveCategoryPathsToShopling(
    [
      "생활/건강 > 욕실용품 > 변기솔",
      "생활/건강 > 욕실용품 > 샤워기",
      "생활/건강 > 욕실용품 > 샤워기",
      "생활/건강 > 욕실용품 > 샤워기",
      "생활/건강 > 욕실용품 > 샤워기",
    ],
    categories,
  );

  assert.equal(matches[0]?.path, "생활/건강 > 욕실용품 > 샤워기");
  assert.equal(matches[0]?.supportCount, 4);
});

test("네이버 카테고리 근거는 검색 상위 5개까지만 사용한다", () => {
  const categories = [
    { path: "생활/건강 > 욕실용품 > 샤워기" },
    { path: "생활/건강 > 욕실용품 > 변기솔" },
  ];

  const matches = matchNaverTopFiveCategoryPathsToShopling(
    [
      "생활/건강 > 욕실용품 > 샤워기",
      "생활/건강 > 욕실용품 > 샤워기",
      "생활/건강 > 욕실용품 > 샤워기",
      "생활/건강 > 욕실용품 > 샤워기",
      "생활/건강 > 욕실용품 > 샤워기",
      "생활/건강 > 욕실용품 > 변기솔",
    ],
    categories,
  );

  assert.equal(matches[0]?.path, "생활/건강 > 욕실용품 > 샤워기");
  assert.equal(matches[0]?.supportCount, 5);
});

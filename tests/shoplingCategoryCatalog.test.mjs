import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  canAutoApplyShoplingCategory,
  inferShoplingCategoryIntent,
  inferShoplingCoreProductTerms,
  normalizeShoplingCategorySearchProfiles,
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

test("모공브러쉬는 색상 블랙이 아니라 브러쉬 제품명사로 후보를 검색한다", () => {
  const categories = [
    {
      depth: 4,
      path: "문구/취미>문구용품>보드/칠판>블랙보드",
      names: ["문구/취미", "문구용품", "보드/칠판", "블랙보드"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "자동차>자동차기기>블랙박스>블랙박스액세서리",
      names: ["자동차", "자동차기기", "블랙박스", "블랙박스액세서리"],
      codes: ["2", "22", "222", "2222"],
    },
    {
      depth: 4,
      path: "생활/건강>화장품/미용>클렌징용품>세안브러시",
      names: ["생활/건강", "화장품/미용", "클렌징용품", "세안브러시"],
      codes: ["3", "33", "333", "3333"],
    },
    {
      depth: 4,
      path: "생활/건강>화장품/미용>미용소품>화장용브러시",
      names: ["생활/건강", "화장품/미용", "미용소품", "화장용브러시"],
      codes: ["4", "44", "444", "4444"],
    },
    {
      depth: 4,
      path: "자동차>세차용품>세차도구>세차브러쉬",
      names: ["자동차", "세차용품", "세차도구", "세차브러쉬"],
      codes: ["5", "55", "555", "5555"],
    },
  ];
  const input = {
    itemId: "AAA489",
    modelNumber: "AAA489",
    productName: "걸이형 모공브러쉬 블랙",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };

  assert.deepEqual(inferShoplingCoreProductTerms(input, categories), ["브러쉬"]);
  const profile = {
    itemId: "AAA489",
    coreProductTerms: [
      "모공브러쉬",
      "모공브러시",
      "세안브러시",
      "클렌징브러시",
      "페이스브러시",
      "화장용브러시",
    ],
    contextTerms: ["세안", "뷰티", "퍼스널케어"],
    ignoredAttributes: ["걸이형", "블랙"],
  };
  const shortlist = shortlistShoplingCategories(input, categories, 18, profile);
  assert.equal(shortlist[0].path, categories[2].path);
  assert.equal(shortlist[1].path, categories[3].path);
  assert.ok(shortlist.some((candidate) => candidate.path === categories[4].path));
  assert.ok(shortlist.every((candidate) => !/블랙보드|블랙박스/.test(candidate.path)));
  assert.ok(shortlist.every((candidate) => candidate.matchKind === "core"));
});

test("재질 단어가 실제 판매 제품이면 AI 핵심명사로 복원한다", () => {
  const categories = [
    {
      depth: 4,
      path: "생활/건강>청소용품>청소도구>스펀지",
      names: ["생활/건강", "청소용품", "청소도구", "스펀지"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "생활/건강>주방용품>설거지용품>수세미",
      names: ["생활/건강", "주방용품", "설거지용품", "수세미"],
      codes: ["2", "22", "222", "2222"],
    },
  ];
  const input = {
    itemId: "material-product",
    modelNumber: "AAA000",
    productName: "세척용 스펀지",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };
  const shortlist = shortlistShoplingCategories(input, categories, 18, {
    itemId: input.itemId,
    coreProductTerms: ["스펀지", "수세미"],
    contextTerms: ["청소", "설거지"],
    ignoredAttributes: ["세척용"],
  });

  assert.deepEqual(
    new Set(shortlist.map((candidate) => candidate.path)),
    new Set(categories.map((category) => category.path)),
  );
  assert.ok(shortlist.every((candidate) => candidate.matchKind === "core"));
});

test("독립 색상어는 제외하지만 블랙보드·블랙박스 합성 제품명은 보존한다", () => {
  const categories = [
    {
      depth: 3,
      path: "가구/인테리어>거실가구>사이드테이블",
      names: ["가구/인테리어", "거실가구", "사이드테이블"],
      codes: ["1", "11", "111"],
    },
    {
      depth: 3,
      path: "문구/취미>보드/칠판>블랙보드",
      names: ["문구/취미", "보드/칠판", "블랙보드"],
      codes: ["2", "22", "222"],
    },
    {
      depth: 3,
      path: "자동차>자동차기기>블랙박스",
      names: ["자동차", "자동차기기", "블랙박스"],
      codes: ["3", "33", "333"],
    },
  ];
  const base = {
    itemId: "item",
    modelNumber: "AAA",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };

  assert.deepEqual(
    inferShoplingCoreProductTerms(
      { ...base, productName: "사이드 테이블 블랙" },
      categories,
    ),
    ["테이블"],
  );
  assert.deepEqual(
    inferShoplingCoreProductTerms(
      { ...base, productName: "블랙보드" },
      categories,
    ),
    ["블랙보드"],
  );
  assert.deepEqual(
    inferShoplingCoreProductTerms(
      { ...base, productName: "블랙박스" },
      categories,
    ),
    ["블랙박스"],
  );
});

test("현재 모델명에 붙어 있는 A형·B형과 용량은 제거하고 제품명사를 유지한다", () => {
  const categories = [
    {
      depth: 4,
      path: "생활/건강>농축산용품>급수용품>닭물통",
      names: ["생활/건강", "농축산용품", "급수용품", "닭물통"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "생활/건강>생활용품>생활잡화>돼지코스토퍼",
      names: ["생활/건강", "생활용품", "생활잡화", "돼지코스토퍼"],
      codes: ["2", "22", "222", "2222"],
    },
  ];
  const base = {
    itemId: "item",
    modelNumber: "AAA",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };

  assert.deepEqual(
    inferShoplingCoreProductTerms(
      { ...base, productName: "닭물통A형 520ml" },
      categories,
    ),
    ["닭물통"],
  );
  assert.deepEqual(
    inferShoplingCoreProductTerms(
      { ...base, productName: "돼지코스토퍼B형" },
      categories,
    ),
    ["돼지코스토퍼"],
  );
});

test("정확한 제품명사 카테고리가 없으면 AI 용도 문맥으로만 후보를 만들고 자동적용 근거를 낮춘다", () => {
  const categories = [
    {
      depth: 4,
      path: "생활/건강>주방용품>조리도구>기타조리도구",
      names: ["생활/건강", "주방용품", "조리도구", "기타조리도구"],
      codes: ["1", "11", "111", "1111"],
    },
    {
      depth: 4,
      path: "문구/취미>공예용품>펀칭용품>종이펀치",
      names: ["문구/취미", "공예용품", "펀칭용품", "종이펀치"],
      codes: ["2", "22", "222", "2222"],
    },
  ];
  const input = {
    itemId: "AAA316",
    modelNumber: "AAA316",
    productName: "계란펀칭기",
    optionLabels: [],
    currentCategory: "",
    chinaProductLinks: [],
  };
  const shortlist = shortlistShoplingCategories(input, categories, 18, {
    itemId: input.itemId,
    coreProductTerms: ["계란펀칭기", "계란구멍뚫기"],
    contextTerms: ["주방", "조리", "계란"],
    ignoredAttributes: [],
  });

  assert.equal(shortlist[0].path, categories[0].path);
  assert.ok(shortlist.every((candidate) => candidate.matchKind === "context"));
  assert.ok(shortlist.every((candidate) => !/종이펀치/.test(candidate.path)));
  assert.equal(
    canAutoApplyShoplingCategory({
      confidence: 99,
      currentCategory: "",
      matchKind: "context",
    }),
    false,
  );
  assert.equal(
    canAutoApplyShoplingCategory({
      confidence: 95,
      currentCategory: "",
      matchKind: "core",
    }),
    true,
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

test("AI 모델명 분석은 제품명사·용도·속성을 분리해 카테고리 검색 프로필을 만든다", async () => {
  const inputs =
    [
      {
        itemId: "AAA489",
        modelNumber: "AAA489",
        productName: "걸이형 모공브러쉬 블랙",
        optionLabels: ["단품"],
        currentCategory: "",
        chinaProductLinks: [],
      },
    ];
  const profiles = normalizeShoplingCategorySearchProfiles(
    [
      {
        itemId: "AAA489",
        coreProductTerms: [
          "모공브러쉬",
          "세안브러쉬",
          "화장용 브러쉬",
          "화장용브러쉬",
        ],
        contextTerms: ["세안", "뷰티", "퍼스널케어"],
        ignoredAttributes: ["걸이형", "블랙", "단품"],
      },
    ],
    inputs,
  );

  assert.deepEqual(profiles, [
    {
      itemId: "AAA489",
      coreProductTerms: ["모공브러쉬", "세안브러쉬", "화장용 브러쉬"],
      contextTerms: ["세안", "뷰티", "퍼스널케어"],
      ignoredAttributes: ["걸이형", "블랙", "단품"],
    },
  ]);
  const source = await readFile(
    new URL("../src/lib/shoplingCategoryCatalog.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /generateShoplingCategorySearchProfiles/);
  assert.match(source, /합성어 안의 색상어/);
  assert.match(source, /브러시\/브러쉬/);
  assert.match(source, /걸이형 모공브러쉬 블랙/);
});

test("진행관리 UI는 카테고리 최신화·AI 후보 생성·수동 로그인 상태를 포함한다", async () => {
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
  assert.match(source, /선택 AI 카테고리 후보 생성/);
  assert.match(source, /manual_login_required/);
  assert.match(source, /categoryAiSuggestion/);
  assert.match(source, /categoryAiStatus: "review_required"/);
  assert.match(source, /shoplingCategory: item\.shoplingCategory/);
  assert.match(app, /category-ai\.js/);
});

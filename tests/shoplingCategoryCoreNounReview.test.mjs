import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("검토 패널은 후보가 없어도 상품과 재분석 버튼을 유지한다", async () => {
  const component = await readFile(
    new URL(
      "../src/components/shopling-category-review/ShoplingCategoryCoreNounReview.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const page = await readFile(
    new URL("../src/app/shopling-category-review-queue/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(component, /loadStateWithRetry/);
  assert.match(component, /attempt <= 3/);
  assert.match(component, /후보 다시 생성/);
  assert.match(component, /item\.candidates\.length \?/);
  assert.match(component, /기존 후보가 모델명의 핵심 제품명사와 맞지 않아 숨겼습니다/);
  assert.match(component, /관련 카테고리를 찾지 못해 검토 상태로 유지/);
  assert.match(component, /웹 검색 근거/);
  assert.match(component, /categoryAiMarketEvidence/);
  assert.match(page, /ShoplingCategoryCoreNounReview/);
  assert.doesNotMatch(page, /ShoplingCategoryCandidateQuickApprove/);
});

test("AI API는 관련 후보가 없을 때 엉뚱한 경로 대신 빈 검토 결과를 반환한다", async () => {
  const route = await readFile(
    new URL(
      "../src/app/api/product-launch-tracker/ai-category/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const catalog = await readFile(
    new URL("../src/lib/shoplingCategoryCatalog.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /generateReliableShoplingCategoryRecommendations/);
  assert.doesNotMatch(route, /shortlistShoplingCategories/);
  assert.match(catalog, /noMatchRecommendation/);
  assert.match(catalog, /selectedPath: ""/);
  assert.match(catalog, /confidence: 0/);
  assert.match(catalog, /엉뚱한 후보는 제시하지 않고 검토 상태로 남겼습니다/);
  assert.match(catalog, /matchKind: "none"/);
});

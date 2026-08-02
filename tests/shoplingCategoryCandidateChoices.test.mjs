import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI 카테고리 API는 모델명 용어와 서로 다른 약 3개 후보를 반환한다", async () => {
  const route = await readFile(
    new URL(
      "../src/app/api/product-launch-tracker/ai-category/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(route, /candidateChoices/);
  assert.match(route, /buildCandidateChoices/);
  assert.match(route, /while \(choices\.length < 3/);
  assert.match(route, /branchKey/);
  assert.match(route, /alternatives: candidateChoices\.slice\(1, 3\)/);
  assert.match(route, /replaceAll\("상품명", "모델명"\)/);
});

test("검토함은 후보 경로를 펼쳐 보여주고 버튼 한 번으로 즉시 승인한다", async () => {
  const component = await readFile(
    new URL(
      "../src/components/shopling-category-review/ShoplingCategoryCandidateQuickApprove.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const page = await readFile(
    new URL("../src/app/shopling-category-review-queue/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(component, /빠른 후보 승인/);
  assert.match(component, /이 후보 승인/);
  assert.match(component, /categoryAiSuggestion/);
  assert.match(component, /categoryAiAlternatives/);
  assert.match(component, /categoryAiCandidatePaths/);
  assert.match(component, /unique\.length >= 3/);
  assert.match(component, /applyShoplingCategoryReviewDecisions/);
  assert.match(component, /action: "approve", category/);
  assert.match(component, /replaceAll\("상품명", "모델명"\)/);
  assert.match(page, /ShoplingCategoryCandidateQuickApprove/);
  assert.match(page, /모델번호, 진행관리의 모델명, 옵션정보/);
});

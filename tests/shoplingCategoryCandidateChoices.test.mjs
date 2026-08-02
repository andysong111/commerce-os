import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI 카테고리 API는 모델명 용어와 관련도 순서의 최대 3개 후보를 반환한다", async () => {
  const route = await readFile(
    new URL(
      "../src/app/api/product-launch-tracker/ai-category/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(route, /candidateChoices/);
  assert.match(route, /buildCandidateChoices/);
  assert.match(route, /slice\(0, 3\)/);
  assert.doesNotMatch(route, /branchKey/);
  assert.match(route, /alternatives: candidateChoices\.slice\(1, 3\)/);
  assert.match(route, /replaceAll\("상품명", "모델명"\)/);
});

test("검토함은 관련 후보만 표시하고 버튼 승인·후보 재생성을 제공한다", async () => {
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
  assert.match(component, /관련성이 검증된 후보/);
  assert.match(component, /이 후보 승인/);
  assert.match(component, /후보 다시 생성/);
  assert.match(component, /AI_ENDPOINT/);
  assert.match(component, /categoryAiCandidateChoices/);
  assert.match(component, /categoryAiCandidatePaths/);
  assert.match(component, /저장된 후보가 모델명의 핵심 제품명사와 맞지 않아 숨겼습니다/);
  assert.match(component, /positive\.some/);
  assert.match(component, /blocked\.some/);
  assert.match(component, /applyShoplingCategoryReviewDecisions/);
  assert.match(component, /action: "approve", category/);
  assert.match(component, /replaceAll\("상품명", "모델명"\)/);
  assert.match(page, /ShoplingCategoryCandidateQuickApprove/);
  assert.match(page, /모델번호, 진행관리의 모델명, 옵션정보/);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  hasShoplingInventoryPseudoCategorySegment,
  sanitizeShoplingCategoryPath,
} from "../src/lib/shoplingCategoryPathSafety.ts";
import { sanitizeShoplingCategorySnapshot } from "../src/lib/shoplingCategorySnapshotSafety.ts";
import { validateLocalShoplingCategorySnapshot } from "../src/lib/shoplingCategoryLocalPublish.ts";
import {
  applyShoplingCategoryReviewDecisions,
  buildShoplingCategoryReviewRows,
} from "../src/lib/shoplingCategoryReview.ts";

function category(stockName, stockCode) {
  return {
    depth: 4,
    path: `생활/건강>몸매관리용품>얼굴관리>${stockName}`,
    names: ["생활/건강", "몸매관리용품", "얼굴관리", stockName],
    codes: ["1", "11", "111", stockCode],
    largeCode: "1",
    largeName: "생활/건강",
    middleCode: "11",
    middleName: "몸매관리용품",
    smallCode: "111",
    smallName: "얼굴관리",
    detailCode: stockCode,
    detailName: stockName,
  };
}

function dirtySnapshot() {
  return {
    schemaVersion: 1,
    source: "shopling_local_playwright",
    status: "success",
    requestId: "shopling-category-test",
    collectedAt: new Date().toISOString(),
    categoryPageUrl: "https://a.shopling.co.kr/prod/prodInfo.phtml?mode=reg",
    categoryCount: 3,
    leafCount: 3,
    levelCounts: { "1": 0, "2": 0, "3": 0, "4": 3 },
    hash: "dirty-hash",
    categories: [
      category("실재고", "stock"),
      category("안전재고", "safe"),
      category("임의재고", "manual"),
    ],
  };
}

test("재고 방식 접미 단계는 실제 샵플링 카테고리 경로에서 제거한다", () => {
  assert.equal(
    sanitizeShoplingCategoryPath(
      "생활/건강>몸매관리용품>얼굴관리>안전재고",
    ),
    "생활/건강>몸매관리용품>얼굴관리",
  );
  assert.equal(
    hasShoplingInventoryPseudoCategorySegment(
      "생활/건강>몸매관리용품>얼굴관리>안전재고",
    ),
    true,
  );
});

test("오염된 스냅샷 3개 경로를 실제 카테고리 1개로 정규화한다", () => {
  const sanitized = sanitizeShoplingCategorySnapshot(dirtySnapshot());

  assert.ok(sanitized);
  assert.equal(sanitized.categoryCount, 1);
  assert.equal(sanitized.categories[0].depth, 3);
  assert.equal(
    sanitized.categories[0].path,
    "생활/건강>몸매관리용품>얼굴관리",
  );
  assert.deepEqual(sanitized.categories[0].codes, ["1", "11", "111"]);
  assert.notEqual(sanitized.hash, "dirty-hash");
});

test("구버전 로컬 실행기가 보낸 오염 결과도 서버 저장 전에 정리한다", () => {
  const validated = validateLocalShoplingCategorySnapshot(dirtySnapshot());

  assert.equal(validated.categoryCount, 1);
  assert.equal(
    validated.categories[0].path,
    "생활/건강>몸매관리용품>얼굴관리",
  );
  assert.equal(validated.categories[0].depth, 3);
});

test("기존 검토함의 오염 후보는 화면 데이터에서 깨끗한 경로로 보정한다", () => {
  const rows = buildShoplingCategoryReviewRows({
    items: [
      {
        id: "item-1",
        modelNumber: "AAA490",
        productName: "걸이형 모공 롱브러쉬",
        categoryAiStatus: "review_required",
        categoryAiSuggestion:
          "생활/건강>몸매관리용품>얼굴관리>안전재고",
        categoryAiAlternatives: [
          "생활/건강>몸매관리용품>얼굴관리>실재고",
          "생활/건강>몸매관리용품>얼굴관리>임의재고",
        ],
        categoryAiConfidence: 30,
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].suggestion, "생활/건강>몸매관리용품>얼굴관리");
  assert.deepEqual(rows[0].alternatives, [
    "생활/건강>몸매관리용품>얼굴관리",
  ]);
});

test("오염된 기존 후보를 승인해도 진행관리에는 정리된 경로만 저장한다", () => {
  const result = applyShoplingCategoryReviewDecisions(
    {
      items: [
        {
          id: "item-1",
          modelNumber: "AAA490",
          productName: "걸이형 모공 롱브러쉬",
          categoryAiStatus: "review_required",
          categoryAiSuggestion:
            "생활/건강>몸매관리용품>얼굴관리>안전재고",
          categoryAiAlternatives: [
            "생활/건강>몸매관리용품>얼굴관리>실재고",
          ],
        },
      ],
    },
    [
      {
        itemId: "item-1",
        action: "approve",
        category: "생활/건강>몸매관리용품>얼굴관리>안전재고",
      },
    ],
    { now: "2026-08-12T00:00:00.000Z" },
  );

  assert.equal(
    result.state.items[0].shoplingCategory,
    "생활/건강>몸매관리용품>얼굴관리",
  );
  assert.equal(
    result.state.items[0].categoryAiSuggestion,
    "생활/건강>몸매관리용품>얼굴관리",
  );
});

test("재고 방식이 중간 단계에 남은 비정상 경로는 승인하지 않는다", () => {
  assert.throws(
    () =>
      applyShoplingCategoryReviewDecisions(
        {
          items: [
            {
              id: "item-1",
              modelNumber: "AAA490",
              categoryAiStatus: "review_required",
              categoryAiSuggestion:
                "생활/건강>몸매관리용품>얼굴관리>안전재고",
            },
          ],
        },
        [
          {
            itemId: "item-1",
            action: "approve",
            category: "생활/건강>안전재고>얼굴관리",
          },
        ],
      ),
    /재고 방식이 포함/,
  );
});

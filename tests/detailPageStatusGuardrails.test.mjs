import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  hasUsableDetailPageMaterials,
  isDetailPageStageCompleted,
  isLegacyCompletedStockSheetItem,
  shouldResetDetailPageStage,
} from "../src/lib/productLaunchDetailPageStatus.ts";
import {
  detailPageSourceLinkFailureDetail,
  detailPageSourceLinkFailureLabel,
  isDetailPageSourceLinkUnavailable,
} from "../src/lib/detailPageSourceLinkFailure.ts";

function launchItem(overrides = {}) {
  return {
    id: "launch-aaa480",
    stages: { detailPage: { status: "완료" } },
    detailPageAsset: {},
    ...overrides,
  };
}

function sourceJob(overrides = {}) {
  return {
    jobId: "00112233-4455-4677-8899-aabbccddeeff",
    itemId: "launch-aaa480",
    status: "failed",
    qaStatus: "failed",
    stage: "source_collection",
    sourceUrl: "https://detail.1688.com/offer/923750431449.html",
    message: "1688 상품정보·이미지 수집에 실패했습니다.",
    error: "1688 수집 실패",
    payload: { source_url: "https://detail.1688.com/offer/923750431449.html" },
    ...overrides,
  };
}

test("detail-page complete state is invalid when HTML and main image materials are missing", () => {
  const missing = launchItem();
  assert.equal(isDetailPageStageCompleted(missing), true);
  assert.equal(hasUsableDetailPageMaterials(missing), false);
  assert.equal(shouldResetDetailPageStage(missing), true);

  const legacyCompleted = launchItem({
    workBatch: "등록완료건",
    source: { import: "stock-sheet-backfill-20260812" },
  });
  assert.equal(isLegacyCompletedStockSheetItem(legacyCompleted), true);
  assert.equal(shouldResetDetailPageStage(legacyCompleted), false);
  assert.equal(
    shouldResetDetailPageStage(
      launchItem({
        workBatch: "등록완료건",
        source: { import: "different-import" },
      }),
    ),
    true,
  );

  const complete = launchItem({
    detailPageAsset: {
      html: '<img src="https://assets.example.com/detail.jpg" />',
      mainImageUrl: "https://assets.example.com/main.jpg",
    },
  });
  assert.equal(hasUsableDetailPageMaterials(complete), true);
  assert.equal(shouldResetDetailPageStage(complete), false);

  assert.equal(
    shouldResetDetailPageStage(
      launchItem({ stages: { detailPage: { status: "미시작" } } }),
    ),
    false,
  );
});

test("removed, blank, or stalled 1688 source failures are classified as link-bad", () => {
  const removed = sourceJob({
    error: "商品已下架 查看该店铺其他上架商品",
  });
  assert.equal(isDetailPageSourceLinkUnavailable(removed), true);
  assert.equal(detailPageSourceLinkFailureLabel(removed), "링크불량");
  assert.match(detailPageSourceLinkFailureDetail(removed), /商品已下架/);

  const blankGeneric = sourceJob();
  assert.equal(isDetailPageSourceLinkUnavailable(blankGeneric), true);
  assert.equal(
    detailPageSourceLinkFailureDetail(blankGeneric),
    "1688 수집 실패",
  );

  assert.equal(
    isDetailPageSourceLinkUnavailable(
      sourceJob({
        error: "1688 수집기 연결 시간이 15분을 초과했습니다.",
      }),
    ),
    true,
  );
});

test("Studio infrastructure failures and jobs with collected evidence are not mislabeled as link failures", () => {
  assert.equal(
    isDetailPageSourceLinkUnavailable(
      sourceJob({
        error: "상세페이지 Studio가 20초 안에 응답하지 않았습니다.",
        stage: "studio_connection",
      }),
    ),
    false,
  );
  assert.equal(
    isDetailPageSourceLinkUnavailable(
      sourceJob({
        error: "로컬 수집기 업데이트가 필요합니다.",
      }),
    ),
    false,
  );
  assert.equal(
    isDetailPageSourceLinkUnavailable(
      sourceJob({
        payload: {
          source_url: "https://detail.1688.com/offer/923750431449.html",
          evidence_urls: ["https://assets.example.com/evidence.jpg"],
        },
      }),
    ),
    false,
  );
});

test("product tracker and AI review pages mount the new guardrails", async () => {
  const productPage = await readFile(
    "src/app/product-launch-tracker/page.tsx",
    "utf8",
  );
  const reviewPage = await readFile(
    "src/app/detail-page-ai-review/page.tsx",
    "utf8",
  );
  const guard = await readFile(
    "src/components/product-launch-flow/ProductLaunchDetailPageStatusGuard.tsx",
    "utf8",
  );
  const sourcePanel = await readFile(
    "src/components/detail-page-ai-review/DetailPageSourceLinkFailurePanel.tsx",
    "utf8",
  );

  assert.match(productPage, /ProductLaunchDetailPageStatusGuard/);
  assert.match(guard, /status: "미시작"/);
  assert.match(guard, /mode: "items"/);
  assert.match(reviewPage, /DetailPageSourceLinkFailurePanel/);
  assert.match(sourcePanel, /검수 필요/);
  assert.match(sourcePanel, /링크불량/);
  assert.match(sourcePanel, /정상 상품 원본 확인 불가/);
  assert.match(sourcePanel, /1688 링크 확인/);
});

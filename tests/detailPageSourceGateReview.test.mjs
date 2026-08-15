import assert from "node:assert/strict";
import test from "node:test";
import {
  detailPageSourceLinkFailureLabel,
  isDetailPageSourceLinkUnavailable,
} from "../src/lib/detailPageSourceLinkFailure.ts";

test("explicit pre-AI source gate failure stays link-unavailable even when bad evidence remains", () => {
  const job = {
    status: "failed",
    qaStatus: "failed",
    stage: "source_collection",
    sourceUrl: "https://detail.1688.com/offer/123.html",
    error:
      "SOURCE_LINK_UNAVAILABLE: 1688 고정링크 1번에서 상품이 내려간 상태를 확인했습니다. AI 생성은 실행하지 않습니다.",
    message: "링크 접근 불가 · AI 생성 시작 전 차단",
    payload: {
      source_url: "https://detail.1688.com/offer/123.html",
      evidence_urls: ["https://assets.example.test/error-screen.jpg"],
    },
  };

  assert.equal(isDetailPageSourceLinkUnavailable(job), true);
  assert.equal(detailPageSourceLinkFailureLabel(job), "링크 접근 불가");
});

test("ordinary failed jobs with valid evidence are still not mislabeled as link failures", () => {
  assert.equal(
    isDetailPageSourceLinkUnavailable({
      status: "failed",
      qaStatus: "failed",
      stage: "source_collection",
      sourceUrl: "https://detail.1688.com/offer/456.html",
      error: "후속 처리 오류",
      payload: {
        evidence_urls: ["https://assets.example.test/real-product.jpg"],
      },
    }),
    false,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  detailPageSourceLinkFailureLabel,
  hasDetailPageSourceIdentityFailure,
  isDetailPageSourceLinkUnavailable,
} from "../src/lib/detailPageSourceLinkFailure.ts";

test("explicit pre-AI source gate failure stays link-bad even when bad evidence remains", () => {
  const job = {
    status: "failed",
    qaStatus: "failed",
    stage: "source_collection",
    sourceUrl: "https://detail.1688.com/offer/123.html",
    error:
      "SOURCE_LINK_UNAVAILABLE: 1688 고정링크 1번에서 상품이 내려간 상태를 확인했습니다. AI 생성은 실행하지 않습니다.",
    message: "링크불량 · AI 이미지 생성 시작 전 차단",
    payload: {
      source_url: "https://detail.1688.com/offer/123.html",
      evidence_urls: ["https://assets.example.test/error-screen.jpg"],
    },
  };

  assert.equal(isDetailPageSourceLinkUnavailable(job), true);
  assert.equal(detailPageSourceLinkFailureLabel(job), "링크불량");
});

test("legacy AAA479-style completed job is reclassified as link-bad from saved analysis", () => {
  const job = {
    status: "success",
    qaStatus: "passed",
    stage: "docked",
    sourceUrl: "https://detail.1688.com/offer/923750431449.html",
    payload: {
      product_name:
        "厂家直售汽车座椅背车载收纳挂钩多功能翻毛皮后排座椅收纳神器-阿里巴巴",
      product_name_hint: "헤드레스트 스웨이드 후크",
      source_product_info: "",
      evidence_urls: ["https://assets.example.test/detail_018.jpg"],
    },
    result: {
      analysis: {
        image_analysis: [
          {
            image_index: 1,
            primary_candidate: true,
            contains_package: false,
            notes:
              "SOURCE_QUALITY_RISK GEOMETRY_RISK 매우 작은 플레이스홀더형 프레임으로 제품 본체 형상 식별 불가",
          },
        ],
      },
      v3RepresentativeIdentityGate: {
        status: "identity_passed_aesthetic_review_ignored",
        summary:
          "소스 기준 이미지에 실제 제품 형상이 보이지 않아 동일성 검증이 불가능합니다.",
      },
    },
  };

  assert.equal(hasDetailPageSourceIdentityFailure(job), true);
  assert.equal(isDetailPageSourceLinkUnavailable(job), true);
  assert.equal(detailPageSourceLinkFailureLabel(job), "링크불량");
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
      result: {
        analysis: {
          image_analysis: [
            {
              image_index: 1,
              primary_candidate: true,
              contains_package: false,
              notes:
                "SOURCE_QUALITY_SAFE CLEAN_PHOTO ROLE:WHOLE GEOMETRY_SAFE product silhouette visible",
            },
          ],
        },
      },
    }),
    false,
  );
});

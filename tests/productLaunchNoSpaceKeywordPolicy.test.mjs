import assert from "node:assert/strict";
import test from "node:test";

import {
  isNoSpaceSearchKeyword,
  sanitizeNoSpaceRecommendationGroup,
  sanitizeNoSpaceRecommendationResult,
  validateNoSpaceExecutionPlan,
} from "../src/lib/productLaunchNoSpaceKeywordPolicy.ts";
import { prepareNoSpaceRecommendationArtifactFiles } from "../src/lib/productLaunchNoSpaceArtifactFiles.ts";
import { parseKeywordRecommendationArtifact } from "../src/lib/productLaunchKeywordRecommendations.ts";
import { POST as postDirectApply } from "../src/app/api/keyword-shopling-direct-apply/run/route.ts";

function item(keyword, overrides = {}) {
  return {
    keyword,
    score: 100,
    quality: "최적",
    source: "test",
    selectedByEngine: true,
    safeAutoApply: true,
    totalSearch: 100,
    competitionIndex: "LOW",
    reason: "exact",
    ...overrides,
  };
}

function group() {
  return {
    goodsKey: "121500",
    optimizedKeywords: ["샤워기 필터", "샤워기필터", "수압상승샤워기"],
    items: [
      item("샤워기 필터"),
      item("샤워기필터"),
      item("수압 상승 샤워기"),
      item("수압상승샤워기"),
      item("검토후보", { safeAutoApply: false, quality: "검토" }),
    ],
    qualityStatus: "PASS",
    confidenceStatus: "PASS",
    engineStatus: "success",
    warnings: [],
  };
}

test("no-space policy rejects spaced candidates without transforming them", () => {
  assert.equal(isNoSpaceSearchKeyword("샤워기필터"), true);
  assert.equal(isNoSpaceSearchKeyword("샤워기 필터"), false);

  const sanitized = sanitizeNoSpaceRecommendationGroup(group());
  assert.deepEqual(
    sanitized.items.map((candidate) => candidate.keyword),
    ["샤워기필터", "수압상승샤워기", "검토후보"],
  );
  assert.deepEqual(sanitized.optimizedKeywords, [
    "샤워기필터",
    "수압상승샤워기",
  ]);
  assert.equal(
    sanitized.items.some((candidate) => candidate.keyword === "샤워기 필터"),
    false,
  );
  assert.match(sanitized.warnings.join(" "), /띄어쓰기 포함 후보 2개/);
});

test("recommendation result preserves metadata and sanitizes every group", () => {
  const source = {
    status: "success",
    phase: "artifact_ready",
    requestId: "keyword-rec-test",
    recommendations: [group()],
  };
  const sanitized = sanitizeNoSpaceRecommendationResult(source);
  assert.equal(sanitized.requestId, "keyword-rec-test");
  assert.equal(sanitized.recommendations.length, 1);
  assert.equal(
    sanitized.recommendations[0].items.every(
      (candidate) => !/\s/.test(candidate.keyword),
    ),
    true,
  );
});

test("artifact policy preserves lower-source exact candidate before parser coalescing", () => {
  const files = {
    "keyword_engine_run_meta.json": JSON.stringify({
      request_id: "keyword-rec-test-001",
      goods_keys: ["121500"],
      status: "success",
    }),
    "keyword_mvp_approval_sheet.csv": [
      "goods_key,new_site_srch,final_site_srch_safe_for_auto_apply_terms,site_srch_keyword_count,site_srch_quality_status,final_site_srch_confidence_status,approval_status,approvable,apply_ready,block_reason,warning_flags",
      '121500,"샤워기 필터,다른후보","샤워기필터,정확후보",2,PASS,PASS,approved,true,true,,',
    ].join("\n"),
    "keyword_mvp_manual_candidates.csv": [
      "goods_key,candidate_keyword,recommendation_tier,safety_status",
      "121500,수압 상승 샤워기,SAFE_REVIEW,SAFE",
      "121500,수압상승샤워기,SAFE_REVIEW,SAFE",
    ].join("\n"),
    "keyword_mvp_auto_promotion_audit.csv": [
      "goods_key,candidate_keyword,decision",
      "121500,여행용 샤워기,PROMOTED",
      "121500,여행용샤워기,PROMOTED",
    ].join("\n"),
    "keyword_mvp_summary.md": "# summary",
  };

  const prepared = prepareNoSpaceRecommendationArtifactFiles(files);
  const parsed = parseKeywordRecommendationArtifact(prepared.files, ["121500"]);
  const recommendation = parsed.groups[0];
  const keywords = recommendation.items.map((candidate) => candidate.keyword);

  assert.ok(prepared.excludedCount >= 3);
  assert.ok(keywords.includes("샤워기필터"));
  assert.ok(keywords.includes("수압상승샤워기"));
  assert.ok(keywords.includes("여행용샤워기"));
  assert.equal(keywords.includes("샤워기 필터"), false);
  assert.equal(keywords.includes("수압 상승 샤워기"), false);
  assert.ok(recommendation.optimizedKeywords.includes("샤워기필터"));
  assert.equal(recommendation.qualityStatus, "REVIEW_REQUIRED");
  assert.equal(recommendation.confidenceStatus, "REVIEW_REQUIRED");
});

function plan(keywords) {
  return JSON.stringify([
    {
      goods_key: "121500",
      mall_key: "SMALL_00001",
      final_title: "상품명",
      final_site_srch: keywords.join(","),
    },
  ]);
}

test("execution plan requires exactly ten no-space keywords", () => {
  const valid = validateNoSpaceExecutionPlan(
    plan(Array.from({ length: 10 }, (_, index) => `검색어${index + 1}`)),
  );
  assert.deepEqual(valid, { ok: true, rowCount: 1 });

  const spaced = validateNoSpaceExecutionPlan(
    plan([
      "샤워기 필터",
      ...Array.from({ length: 9 }, (_, index) => `검색어${index + 1}`),
    ]),
  );
  assert.equal(spaced.ok, false);
  assert.match(spaced.message, /띄어쓰기 검색어/);
  assert.equal(spaced.keyword, "샤워기 필터");

  const underfilled = validateNoSpaceExecutionPlan(
    plan(Array.from({ length: 9 }, (_, index) => `검색어${index + 1}`)),
  );
  assert.equal(underfilled.ok, false);
  assert.match(underfilled.message, /정확히 10개/);
});

test("direct apply route blocks spaced keywords before dispatch configuration", async () => {
  delete process.env.KEYWORD_SHOPLING_DIRECT_APPLY_ACTIONS_TOKEN;
  delete process.env.KEYWORD_SHOPLING_APPLY_ACTIONS_TOKEN;
  const response = await postDirectApply(
    new Request("http://localhost/api/keyword-shopling-direct-apply/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        execution_plan_json: plan([
          "샤워기 필터",
          ...Array.from({ length: 9 }, (_, index) => `검색어${index + 1}`),
        ]),
        confirmation_text: "APPLY_REVIEWED_TITLES_AND_SEARCH_TO_SHOPLING",
        max_items: 100,
      }),
    }),
  );
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.status, "error");
  assert.equal(body.keyword, "샤워기 필터");
  assert.match(
    body.message,
    /키워드 엔진에서 해당 붙여쓰기 문자열의 SearchAd 지표를 다시 조회/,
  );
});

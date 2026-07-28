import assert from "node:assert/strict";
import test from "node:test";
import {
  applyOptimizedRecommendedKeywords,
  parseKeywordRecommendationArtifact,
  splitRecommendationTerms,
  toggleRecommendedKeyword,
} from "../src/lib/productLaunchKeywordRecommendations.ts";

function csv(headers, rows) {
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\n");
}

const approvalHeaders = [
  "goods_key",
  "new_site_srch",
  "site_srch_quality_status",
  "final_site_srch_confidence_status",
  "approval_status",
  "approvable",
  "apply_ready",
  "auto_blocked",
  "block_reason",
  "final_site_srch_safe_for_auto_apply_terms",
  "auto_promoted_site_srch_terms",
  "top_opportunity_keywords",
  "warning_flags",
];

const manualHeaders = [
  "goods_key",
  "candidate_keyword",
  "total_search",
  "comp_idx",
  "seller_quality_status",
  "rejection_reason",
  "safety_status",
  "recommendation_tier",
];

function artifactFiles({ approvalRows, manualRows = [], auditRows = [] }) {
  return {
    "keyword_engine_run_meta.json": JSON.stringify({
      request_id: "keyword-rec-test-001",
      goods_keys: ["121500"],
      status: "success",
    }),
    "keyword_mvp_approval_sheet.csv": csv(approvalHeaders, approvalRows),
    "keyword_mvp_manual_candidates.csv": csv(manualHeaders, manualRows),
    "keyword_mvp_auto_promotion_audit.csv": csv(
      ["goods_key", "candidate_keyword", "decision"],
      auditRows,
    ),
    "keyword_mvp_summary.md": "# summary",
  };
}

test("quality-passed engine final terms are first in optimized keywords", () => {
  const finalKeywords = Array.from({ length: 10 }, (_, index) => `최적${index + 1}`);
  const parsed = parseKeywordRecommendationArtifact(
    artifactFiles({
      approvalRows: [
        [
          "121500",
          finalKeywords.join(","),
          "PASS",
          "PASS",
          "approved",
          "true",
          "true",
          "false",
          "",
          "안전후보1,안전후보2",
          "승격후보",
          "기회후보",
          "",
        ],
      ],
      manualRows: [
        ["121500", "검증후보", "1200", "0.2", "VERIFIED", "safe_candidate_not_selected", "SAFE", "SAFE_REVIEW"],
      ],
    }),
    ["121500"],
  );

  const group = parsed.groups[0];
  assert.deepEqual(group.optimizedKeywords, finalKeywords);
  assert.deepEqual(group.items.slice(0, 10).map((item) => item.keyword), finalKeywords);
  assert.ok(group.items.slice(0, 10).every((item) => item.quality === "최적"));
  assert.ok(group.items.slice(0, 10).every((item) => item.safeAutoApply));
  assert.equal(group.items.find((item) => item.keyword === "기회후보").safeAutoApply, false);
});

test("quality-failed engine final terms stay visible but are excluded from auto apply", () => {
  const parsed = parseKeywordRecommendationArtifact(
    artifactFiles({
      approvalRows: [
        [
          "121500",
          "검토1,검토2,검토3",
          "REVIEW_REQUIRED",
          "REVIEW_REQUIRED",
          "manual_review",
          "false",
          "false",
          "false",
          "QUALITY_REVIEW",
          "안전1,안전2",
          "",
          "기회1",
          "QUALITY_WARNING",
        ],
      ],
    }),
    ["121500"],
  );

  const group = parsed.groups[0];
  assert.deepEqual(group.optimizedKeywords, ["안전1", "안전2"]);
  for (const keyword of ["검토1", "검토2", "검토3"]) {
    const item = group.items.find((candidate) => candidate.keyword === keyword);
    assert.equal(item.quality, "검토");
    assert.equal(item.safeAutoApply, false);
  }
  assert.match(group.warnings.join(" "), /자동 적용에서 제외/);
});

test("rejected drift and attribute-only candidates are not shown", () => {
  const parsed = parseKeywordRecommendationArtifact(
    artifactFiles({
      approvalRows: [
        ["121500", "정상1", "PASS", "PASS", "approved", "true", "true", "false", "", "", "", "", ""],
      ],
      manualRows: [
        ["121500", "안전검증", "500", "0.1", "VERIFIED", "safe_candidate_not_selected", "SAFE", "SAFE_REVIEW"],
        ["121500", "다른상품", "10000", "0.1", "REJECTED", "identity_dimension_changed", "REJECTED", "REJECTED_DRIFT"],
        ["121500", "대형", "9000", "0.1", "REJECTED", "attribute_only", "REJECTED", "REJECTED_ATTRIBUTE_ONLY"],
      ],
    }),
    ["121500"],
  );

  const keywords = parsed.groups[0].items.map((item) => item.keyword);
  assert.ok(keywords.includes("안전검증"));
  assert.ok(!keywords.includes("다른상품"));
  assert.ok(!keywords.includes("대형"));
});

test("click selection toggles terms without exceeding ten", () => {
  let value = "하나,둘";
  value = toggleRecommendedKeyword(value, "셋");
  assert.equal(value, "하나,둘,셋");
  value = toggleRecommendedKeyword(value, "둘");
  assert.equal(value, "하나,셋");

  const full = Array.from({ length: 10 }, (_, index) => `키워드${index + 1}`).join(",");
  assert.equal(toggleRecommendedKeyword(full, "열한번째"), full);
});

test("optimized apply deduplicates and limits to ten", () => {
  const terms = ["A", "a", ...Array.from({ length: 12 }, (_, index) => `K${index + 1}`)];
  const applied = applyOptimizedRecommendedKeywords(terms);
  assert.equal(splitRecommendationTerms(applied).length, 10);
  assert.deepEqual(splitRecommendationTerms(applied).slice(0, 3), ["A", "K1", "K2"]);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCT_LAUNCH_SIMPLE_SESSION_KEY,
  clearProductLaunchSimpleSession,
  createEmptyProductLaunchSimpleSession,
  isSuccessfulSimpleUploadResult,
  parseProductLaunchSimpleSession,
  readProductLaunchSimpleSession,
  writeProductLaunchSimpleSession,
} from "../src/lib/productLaunchSimpleSession.ts";

function successUpload(overrides = {}) {
  return {
    status: "success",
    phase: "artifact_ready",
    runConclusion: "success",
    summary: {
      status: "success",
      exit_code: 0,
      fail_count: 0,
      rows: [
        {
          goods_key: "121500",
          ptn_goods_cd: "BAA1-1a",
          status: "success",
          success: true,
          code: "OK",
        },
      ],
    },
    ...overrides,
  };
}

test("complete upload is required before pricing", () => {
  assert.equal(isSuccessfulSimpleUploadResult(successUpload()), true);
  assert.equal(
    isSuccessfulSimpleUploadResult(
      successUpload({
        status: "success",
        summary: {
          status: "partial_failure",
          exit_code: 1,
          fail_count: 1,
          rows: [
            {
              goods_key: "121500",
              status: "success",
              success: true,
              code: "OK",
            },
            {
              goods_key: "",
              status: "failed",
              success: false,
              code: "ERROR",
            },
          ],
        },
      }),
    ),
    false,
  );
  assert.equal(
    isSuccessfulSimpleUploadResult(
      successUpload({ runConclusion: "failure" }),
    ),
    false,
  );
  assert.equal(
    isSuccessfulSimpleUploadResult(
      successUpload({
        summary: {
          status: "success",
          exit_code: 0,
          fail_count: 0,
          rows: [
            {
              goods_key: "121500",
              status: "success",
              success: true,
              code: "OK",
            },
            {
              goods_key: "",
              status: "failed",
              success: false,
              code: "ERROR",
            },
          ],
        },
      }),
    ),
    false,
  );
});

test("simple launch session round trips only the versioned state", () => {
  const values = new Map();
  const storage = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  const session = {
    ...createEmptyProductLaunchSimpleSession(
      new Date("2026-07-28T00:00:00Z"),
    ),
    rowExpression: "950",
    uploadRequestId: "upload-1",
    uploadResult: successUpload(),
    priceRequestId: "price-1",
    recommendationRequestId: "keyword-rec-test-001",
    recommendationResult: {
      status: "success",
      phase: "artifact_ready",
      recommendations: [
        {
          goodsKey: "121500",
          optimizedKeywords: ["검색어1"],
          items: [],
          qualityStatus: "PASS",
          confidenceStatus: "PASS",
          engineStatus: "success",
          warnings: [],
        },
      ],
    },
    recommendationPolls: 3,
    titles: { "121500": "상품명 후보" },
    searches: { "121500": "검색어1,검색어2" },
    directRequestId: "direct-1",
  };
  writeProductLaunchSimpleSession(storage, session);
  assert.ok(values.has(PRODUCT_LAUNCH_SIMPLE_SESSION_KEY));
  assert.deepEqual(readProductLaunchSimpleSession(storage), session);
  clearProductLaunchSimpleSession(storage);
  assert.equal(readProductLaunchSimpleSession(storage), null);
});

test("invalid or unknown session versions are ignored", () => {
  assert.equal(parseProductLaunchSimpleSession(null), null);
  assert.equal(parseProductLaunchSimpleSession({ version: 2 }), null);
  const parsed = parseProductLaunchSimpleSession({
    version: 1,
    rowExpression: 950,
    uploadPolls: -1,
    titles: { " 121500 ": 123 },
  });
  assert.equal(parsed.rowExpression, "950");
  assert.equal(parsed.uploadPolls, 0);
  assert.deepEqual(parsed.titles, { "121500": "123" });
  assert.equal(parsed.recommendationRequestId, "");
  assert.equal(parsed.recommendationResult, null);
  assert.equal(parsed.recommendationPolls, 0);
});

test("legacy sessions that already started direct apply skip late recommendations", () => {
  const parsed = parseProductLaunchSimpleSession({
    version: 1,
    rowExpression: "950",
    priceRequestId: "price-old",
    priceResult: { status: "success", phase: "artifact_ready" },
    directRequestId: "direct-old",
    directResult: { status: "success", phase: "artifact_ready" },
  });
  assert.equal(parsed.recommendationRequestId, "");
  assert.equal(parsed.recommendationResult.status, "skipped");
  assert.equal(parsed.recommendationResult.phase, "artifact_ready");
  assert.match(parsed.recommendationResult.message, /건너뛰었습니다/);
});

test("restored spaced recommendations repoll the same request and drop spaced search input", () => {
  const parsed = parseProductLaunchSimpleSession({
    version: 1,
    rowExpression: "986",
    recommendationRequestId: "keyword-rec-old-001",
    recommendationResult: {
      status: "success",
      phase: "artifact_ready",
      recommendations: [
        {
          goodsKey: "121500",
          optimizedKeywords: ["샤워기 필터", "샤워기필터"],
          items: [
            {
              keyword: "샤워기 필터",
              score: 100,
              quality: "최적",
              source: "old",
              selectedByEngine: true,
              safeAutoApply: true,
              totalSearch: 100,
              competitionIndex: "LOW",
              reason: "old",
            },
          ],
          qualityStatus: "PASS",
          confidenceStatus: "PASS",
          engineStatus: "success",
          warnings: [],
        },
      ],
    },
    recommendationPolls: 60,
    searches: {
      "121500": "샤워기 필터,샤워기필터,수압상승샤워기",
    },
  });

  assert.equal(parsed.recommendationRequestId, "keyword-rec-old-001");
  assert.equal(parsed.recommendationResult, null);
  assert.equal(parsed.recommendationPolls, 0);
  assert.equal(parsed.searches["121500"], "샤워기필터,수압상승샤워기");
});

test("restored completed direct sessions sanitize recommendations without repolling", () => {
  const parsed = parseProductLaunchSimpleSession({
    version: 1,
    recommendationRequestId: "keyword-rec-old-002",
    recommendationResult: {
      status: "success",
      phase: "artifact_ready",
      recommendations: [
        {
          goodsKey: "121500",
          optimizedKeywords: ["샤워기 필터", "샤워기필터"],
          items: [
            {
              keyword: "샤워기 필터",
              score: 100,
              quality: "최적",
              source: "old",
              selectedByEngine: true,
              safeAutoApply: true,
              totalSearch: 100,
              competitionIndex: "LOW",
              reason: "old",
            },
            {
              keyword: "샤워기필터",
              score: 90,
              quality: "최적",
              source: "exact",
              selectedByEngine: true,
              safeAutoApply: true,
              totalSearch: 80,
              competitionIndex: "MID",
              reason: "exact",
            },
          ],
          qualityStatus: "PASS",
          confidenceStatus: "PASS",
          engineStatus: "success",
          warnings: [],
        },
      ],
    },
    recommendationPolls: 2,
    directRequestId: "direct-completed",
    directResult: { status: "success", phase: "artifact_ready" },
  });

  assert.equal(parsed.recommendationPolls, 2);
  assert.equal(parsed.recommendationResult.recommendations[0].items.length, 1);
  assert.equal(
    parsed.recommendationResult.recommendations[0].items[0].keyword,
    "샤워기필터",
  );
});

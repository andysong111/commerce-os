import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKeywordRecommendationDispatchInput,
  fetchKeywordRecommendationResult,
  isValidKeywordRecommendationRequestId,
  normalizeKeywordRecommendationGoodsKeys,
} from "../src/lib/productLaunchKeywordRecommendationRunner.ts";

function files(requestId = "keyword-rec-test-001", goodsKeys = ["121500"]) {
  return {
    "keyword_engine_run_meta.json": JSON.stringify({
      request_id: requestId,
      goods_keys: goodsKeys,
      status: "success",
    }),
    "keyword_mvp_approval_sheet.csv": [
      "goods_key,new_site_srch,site_srch_quality_status,final_site_srch_confidence_status,approval_status,approvable,apply_ready,auto_blocked,block_reason",
      `${goodsKeys[0]},"키1,키2,키3,키4,키5,키6,키7,키8,키9,키10",PASS,PASS,approved,true,true,false,`,
    ].join("\n"),
    "keyword_mvp_manual_candidates.csv": "goods_key,candidate_keyword",
    "keyword_mvp_summary.md": "# summary",
    "keyword_mvp_auto_promotion_audit.csv":
      "goods_key,candidate_keyword,decision",
  };
}

function deps({
  displayTitle = "Keyword Engine Runner - keyword-rec-test-001",
  runStatus = "completed",
  runConclusion = "success",
  artifactFiles = files(),
} = {}) {
  return {
    listRuns: async () => [
      {
        id: 77,
        name: "Keyword Engine Runner",
        displayTitle,
        status: runStatus,
        conclusion: runConclusion,
        event: "workflow_dispatch",
        branch: "main",
        headSha: "abc",
        createdAt: "2026-07-28T00:00:00Z",
        updatedAt: "2026-07-28T00:01:00Z",
        htmlUrl: "https://github.test/run/77",
        runNumber: 77,
        runAttempt: 1,
      },
    ],
    listArtifacts: async () => [
      {
        id: 88,
        name: "keyword-engine-mvp-output",
        sizeInBytes: 100,
        expired: false,
        createdAt: "2026-07-28T00:01:00Z",
        updatedAt: "2026-07-28T00:01:00Z",
        archiveDownloadUrlAvailable: true,
        expected: true,
      },
    ],
    downloadArtifact: async () => new Uint8Array([1, 2, 3]),
    extractArtifact: () => ({
      files: artifactFiles,
      missingFiles: [],
      skippedFiles: [],
      foundSafeFiles: Object.keys(artifactFiles),
    }),
  };
}

async function withToken(fn) {
  const previous = process.env.GITHUB_ENGINE_DISPATCH_TOKEN;
  process.env.GITHUB_ENGINE_DISPATCH_TOKEN = "test-token";
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.GITHUB_ENGINE_DISPATCH_TOKEN;
    else process.env.GITHUB_ENGINE_DISPATCH_TOKEN = previous;
  }
}

test("goods key and request validation is fail closed", () => {
  assert.deepEqual(
    normalizeKeywordRecommendationGoodsKeys("121500,121501,121500"),
    ["121500", "121501"],
  );
  assert.throws(
    () => normalizeKeywordRecommendationGoodsKeys("AAA1"),
    /형식/,
  );
  assert.throws(
    () =>
      normalizeKeywordRecommendationGoodsKeys(
        Array.from({ length: 51 }, (_, index) => String(100000 + index)),
      ),
    /최대 50개/,
  );
  assert.equal(
    isValidKeywordRecommendationRequestId("keyword-rec-test-001"),
    true,
  );
  assert.equal(isValidKeywordRecommendationRequestId("bad-id"), false);
});

test("dispatch input includes exact request id and review-only mode", () => {
  const parsed = buildKeywordRecommendationDispatchInput({
    goods_keys: ["121500", "121501"],
    request_id: "keyword-rec-test-001",
  });
  assert.deepEqual(parsed.goodsKeys, ["121500", "121501"]);
  assert.deepEqual(parsed.workflowInputs, {
    goods_key: "121500,121501",
    seed_keyword: "",
    request_id: "keyword-rec-test-001",
    mode: "dry_run",
  });
});

test("exact completed run returns safe parsed recommendations", async () => {
  await withToken(async () => {
    const result = await fetchKeywordRecommendationResult(
      "keyword-rec-test-001",
      "121500",
      deps(),
    );
    assert.equal(result.status, "success");
    assert.equal(result.phase, "artifact_ready");
    assert.equal(result.requestId, "keyword-rec-test-001");
    assert.equal(result.runId, 77);
    assert.equal(result.artifactId, 88);
    assert.equal(result.recommendations.length, 1);
    assert.equal(result.recommendations[0].goodsKey, "121500");
    assert.deepEqual(result.recommendations[0].optimizedKeywords, [
      "키1",
      "키2",
      "키3",
      "키4",
      "키5",
      "키6",
      "키7",
      "키8",
      "키9",
      "키10",
    ]);
    assert.equal(Object.hasOwn(result, "files"), false);
  });
});

test("queued exact run remains pending without downloading artifact", async () => {
  await withToken(async () => {
    let downloaded = false;
    const custom = deps({ runStatus: "in_progress", runConclusion: null });
    custom.downloadArtifact = async () => {
      downloaded = true;
      return new Uint8Array();
    };
    const result = await fetchKeywordRecommendationResult(
      "keyword-rec-test-001",
      "121500",
      custom,
    );
    assert.equal(result.status, "pending");
    assert.equal(result.phase, "running");
    assert.equal(downloaded, false);
  });
});

test("failed or cancelled runs reject artifacts without downloading them", async () => {
  await withToken(async () => {
    for (const conclusion of ["failure", "cancelled"]) {
      let downloaded = false;
      const custom = deps({ runStatus: "completed", runConclusion: conclusion });
      custom.downloadArtifact = async () => {
        downloaded = true;
        return new Uint8Array();
      };
      const result = await fetchKeywordRecommendationResult(
        "keyword-rec-test-001",
        "121500",
        custom,
      );
      assert.equal(result.status, "error");
      assert.equal(result.phase, "failed");
      assert.equal(result.runConclusion, conclusion);
      assert.equal(downloaded, false);
      assert.match(result.message, /성공하지 않았습니다/);
    }
  });
});

test("wrong artifact request id and goods keys are rejected", async () => {
  await withToken(async () => {
    const wrongRequest = await fetchKeywordRecommendationResult(
      "keyword-rec-test-001",
      "121500",
      deps({ artifactFiles: files("keyword-rec-other", ["121500"]) }),
    );
    assert.equal(wrongRequest.status, "error");
    assert.match(wrongRequest.message, /request_id/);

    const wrongGoods = await fetchKeywordRecommendationResult(
      "keyword-rec-test-001",
      "121500",
      deps({
        artifactFiles: files("keyword-rec-test-001", ["121999"]),
      }),
    );
    assert.equal(wrongGoods.status, "error");
    assert.match(wrongGoods.message, /상품번호/);
  });
});

test("missing exact metadata is rejected", async () => {
  await withToken(async () => {
    const artifactFiles = files();
    delete artifactFiles["keyword_engine_run_meta.json"];
    const result = await fetchKeywordRecommendationResult(
      "keyword-rec-test-001",
      "121500",
      deps({ artifactFiles }),
    );
    assert.equal(result.status, "error");
    assert.match(result.message, /메타파일/);
  });
});

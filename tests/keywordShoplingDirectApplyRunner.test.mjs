import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import {
  KEYWORD_SHOPLING_DIRECT_APPLY_CONFIRMATION,
  buildKeywordShoplingDirectApplyDispatch,
  dispatchKeywordShoplingDirectApply,
  extractKeywordShoplingDirectApplyArtifact,
  fetchKeywordShoplingDirectApplyResult,
  parseKeywordShoplingDirectPlan,
} from "../src/lib/keywordShoplingDirectApplyRunner.ts";

const planRows = [
  {
    goods_key: "121417",
    mall_key: "SMALL_00001",
    final_title: "족구패드 야구패드 골프패드 배구패드",
    final_site_srch: "키워드1,키워드2,키워드3,키워드4,키워드5,키워드6,키워드7,키워드8,키워드9,키워드10",
  },
  {
    goods_key: "121417",
    mall_key: "SMALL_00002",
    final_title: "야구패드 족구패드 배구패드 골프패드",
    final_site_srch: "키워드1,키워드2,키워드3,키워드4,키워드5,키워드6,키워드7,키워드8,키워드9,키워드10",
  },
];

function withEnv(fn) {
  const old = { ...process.env };
  process.env.KEYWORD_SHOPLING_APPLY_ENABLED = "1";
  process.env.KEYWORD_SHOPLING_APPLY_REPO =
    "andysong111/andysong111-keyword-engine-soon";
  process.env.KEYWORD_SHOPLING_APPLY_REF = "main";
  process.env.KEYWORD_SHOPLING_APPLY_ACTIONS_TOKEN = "ghp_test_token";
  try {
    return fn();
  } finally {
    process.env = old;
  }
}

test("direct plan accepts exact compact contract", () => {
  assert.deepEqual(parseKeywordShoplingDirectPlan(JSON.stringify(planRows)), planRows);
});

test("direct plan rejects duplicate targets and inconsistent goods search", () => {
  assert.throws(() =>
    parseKeywordShoplingDirectPlan(
      JSON.stringify([planRows[0], { ...planRows[0] }]),
    ),
  );
  assert.throws(() =>
    parseKeywordShoplingDirectPlan(
      JSON.stringify([
        planRows[0],
        { ...planRows[1], final_site_srch: "다른키워드" },
      ]),
    ),
  );
});

test("dispatch contract targets direct workflow only", () =>
  withEnv(() => {
    const request = buildKeywordShoplingDirectApplyDispatch({
      execution_plan_json: JSON.stringify(planRows),
      confirmation_text: KEYWORD_SHOPLING_DIRECT_APPLY_CONFIRMATION,
      max_items: 100,
    });
    assert.match(request.url, /keyword-shopling-direct-apply\.yml/);
    assert.equal(request.body.inputs.max_items, "100");
    assert.equal(request.itemCount, 2);
    assert.equal(
      request.body.inputs.confirmation_text,
      KEYWORD_SHOPLING_DIRECT_APPLY_CONFIRMATION,
    );
    assert.equal(
      Object.hasOwn(request.body.inputs, "title_apply_phase"),
      false,
    );
    assert.equal(
      Object.hasOwn(request.body.inputs, "confirmed_canary_goods_key"),
      false,
    );
  }));

test("wrong confirmation blocks before GitHub request", async () =>
  withEnv(async () => {
    let calls = 0;
    const oldFetch = global.fetch;
    global.fetch = async () => {
      calls += 1;
      throw new Error("network should not run");
    };
    try {
      const result = await dispatchKeywordShoplingDirectApply({
        execution_plan_json: JSON.stringify(planRows),
        confirmation_text: "wrong",
        max_items: 100,
      });
      assert.equal(result.status, "error");
      assert.equal(calls, 0);
    } finally {
      global.fetch = oldFetch;
    }
  }));

test("artifact extraction keeps safe summary and drops transcripts", () => {
  const summary = {
    request_id: "direct-apply-20260728T100000Z-abc123",
    status: "success",
    direct_apply_completed: true,
    price_repair_required: false,
    requires_final_price_pass: false,
    title_apply_success_count: 2,
    failed_item_count: 0,
    request_xml: "secret",
    response_xml: "secret",
  };
  const rows = [
    {
      goods_key: "121417",
      mall_key: "SMALL_00001",
      title_update_status: "success",
      site_srch_update_status: "verified",
      Cookie: "secret",
    },
  ];
  const zip = zipSync({
    "output/shopling_direct_apply/result_summary.json": strToU8(
      JSON.stringify(summary),
    ),
    "output/shopling_direct_apply/apply_results.jsonl": strToU8(
      `${JSON.stringify(rows[0])}\n`,
    ),
    "output/shopling_direct_apply/blocked_items.jsonl": strToU8(""),
    "output/shopling_direct_apply/api_transcripts.jsonl": strToU8(
      JSON.stringify({ request_xml_masked: "<xml />" }),
    ),
  });
  const extracted = extractKeywordShoplingDirectApplyArtifact(zip);
  assert.equal(extracted.summary.direct_apply_completed, true);
  assert.equal(extracted.summary.price_repair_required, false);
  assert.equal(Object.hasOwn(extracted.summary, "request_xml"), false);
  assert.equal(Object.hasOwn(extracted.summary, "response_xml"), false);
  assert.equal(extracted.applyResults.length, 1);
  assert.equal(Object.hasOwn(extracted.applyResults[0], "Cookie"), false);
  assert.equal(Object.hasOwn(extracted, "apiTranscripts"), false);
});

test("result fetch matches request id from artifact, not neighboring run", async () =>
  withEnv(async () => {
    const requestId = "direct-apply-20260728T100000Z-abc123";
    const zip = zipSync({
      "output/shopling_direct_apply/result_summary.json": strToU8(
        JSON.stringify({
          request_id: requestId,
          status: "success",
          direct_apply_completed: true,
          failed_item_count: 0,
          price_repair_required: false,
          requires_final_price_pass: false,
        }),
      ),
      "output/shopling_direct_apply/apply_results.jsonl": strToU8(""),
      "output/shopling_direct_apply/blocked_items.jsonl": strToU8(""),
    });
    const oldFetch = global.fetch;
    global.fetch = async (url) => {
      const value = String(url);
      if (value.includes("/runs?"))
        return new Response(
          JSON.stringify({
            workflow_runs: [
              {
                id: 10,
                status: "completed",
                conclusion: "success",
                html_url: "https://example/run/10",
                display_title: `Direct launch apply - ${requestId}`,
              },
            ],
          }),
          { status: 200 },
        );
      if (value.endsWith("/actions/runs/10/artifacts"))
        return new Response(
          JSON.stringify({
            artifacts: [
              {
                name: "keyword-shopling-direct-apply-result",
                archive_download_url: "https://example/artifact.zip",
              },
            ],
          }),
          { status: 200 },
        );
      if (value === "https://example/artifact.zip")
        return new Response(zip, { status: 200 });
      throw new Error(`unexpected URL ${value}`);
    };
    try {
      const result = await fetchKeywordShoplingDirectApplyResult(requestId);
      assert.equal(result.status, "success");
      assert.equal(result.phase, "artifact_ready");
      assert.equal(result.summary.direct_apply_completed, true);
    } finally {
      global.fetch = oldFetch;
    }
  }));

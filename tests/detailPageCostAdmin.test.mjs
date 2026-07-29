import assert from "node:assert/strict";
import test from "node:test";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const {
  aggregateRecentDetailPageCostRuns,
  isDetailPageCostAdmin,
  normalizeDetailPageCostRuns,
  normalizeDetailPageCostSummary,
} = await importTranspiledTypeScript(
  new URL("../src/lib/detailPageCostAdmin.ts", import.meta.url),
);

test("only the configured owner email passes the cost admin gate", () => {
  const previous = process.env.DETAIL_PAGE_COST_ADMIN_EMAIL;
  process.env.DETAIL_PAGE_COST_ADMIN_EMAIL = "owner@example.com";
  try {
    assert.equal(isDetailPageCostAdmin("OWNER@example.com"), true);
    assert.equal(isDetailPageCostAdmin("other@example.com"), false);
    assert.equal(isDetailPageCostAdmin(null), false);
  } finally {
    if (previous === undefined) delete process.env.DETAIL_PAGE_COST_ADMIN_EMAIL;
    else process.env.DETAIL_PAGE_COST_ADMIN_EMAIL = previous;
  }
});

test("summary values from PostgREST JSON normalize to numbers", () => {
  assert.deepEqual(
    normalizeDetailPageCostSummary({
      total_cost_usd: "1.25",
      today_cost_usd: 0.5,
      run_count: 3,
      today_run_count: "1",
      event_count: 20,
      unpriced_event_count: 2,
    }),
    {
      total_cost_usd: 1.25,
      today_cost_usd: 0.5,
      run_count: 3,
      today_run_count: 1,
      event_count: 20,
      unpriced_event_count: 2,
    },
  );
});

test("complete run aggregates from PostgREST normalize to display rows", () => {
  assert.deepEqual(
    normalizeDetailPageCostRuns([
      {
        run_id: "run-1",
        product_name: "쿠션",
        output_language: "한국어",
        generation_profile: "standard",
        created_at: "2026-07-29T12:02:00Z",
        cost_usd: "0.24",
        event_count: "3",
        image_calls: 1,
        verifier_calls: "1",
        has_unpriced_event: false,
      },
      {
        run_id: "",
        created_at: "2026-07-29T12:03:00Z",
      },
    ]),
    [
      {
        run_id: "run-1",
        product_name: "쿠션",
        output_language: "한국어",
        generation_profile: "standard",
        created_at: "2026-07-29T12:02:00Z",
        cost_usd: 0.24,
        event_count: 3,
        image_calls: 1,
        verifier_calls: 1,
        has_unpriced_event: false,
      },
    ],
  );
  assert.deepEqual(normalizeDetailPageCostRuns(null), []);
});

test("recent events aggregate into one run including retries and verifiers", () => {
  const rows = [
    {
      id: 3,
      run_id: "run-1",
      event_type: "visual_verifier",
      generation_profile: "standard",
      model: "gpt-5-mini",
      slot: 1,
      product_name: "쿠션",
      output_language: "한국어",
      estimated_cost_usd: "0.01",
      pricing_status: "estimated",
      pricing_version: "openai-2026-07-29",
      created_at: "2026-07-29T12:02:00Z",
    },
    {
      id: 2,
      run_id: "run-1",
      event_type: "image_generation",
      generation_profile: "standard",
      model: "gpt-image-2",
      slot: 1,
      product_name: "쿠션",
      output_language: "한국어",
      estimated_cost_usd: "0.20",
      pricing_status: "estimated",
      pricing_version: "openai-2026-07-29",
      created_at: "2026-07-29T12:01:00Z",
    },
    {
      id: 1,
      run_id: "run-1",
      event_type: "product_analysis",
      generation_profile: "standard",
      model: "gpt-5.6-terra",
      slot: null,
      product_name: "쿠션",
      output_language: "한국어",
      estimated_cost_usd: "0.03",
      pricing_status: "estimated",
      pricing_version: "openai-2026-07-29",
      created_at: "2026-07-29T12:00:00Z",
    },
  ];

  assert.deepEqual(aggregateRecentDetailPageCostRuns(rows), [
    {
      run_id: "run-1",
      product_name: "쿠션",
      output_language: "한국어",
      generation_profile: "standard",
      created_at: "2026-07-29T12:02:00Z",
      cost_usd: 0.24000000000000002,
      event_count: 3,
      image_calls: 1,
      verifier_calls: 1,
      has_unpriced_event: false,
    },
  ]);
});

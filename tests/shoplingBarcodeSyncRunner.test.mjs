import test from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const {
  SHOPLING_BARCODE_SYNC_VERIFIED_CANARY_KEYS,
  buildShoplingBarcodeSyncDispatchRequest,
  buildShoplingBarcodeSyncRunsUrl,
  extractShoplingBarcodeSyncResultSummary,
  fetchShoplingBarcodeSyncActionsResult,
  generateShoplingBarcodeSyncRequestId,
  isValidShoplingBarcodeSyncRequestId,
  parseShoplingBarcodeSyncRequestTimestamp,
  validateShoplingBarcodeSyncRunInput,
} = await importTranspiledTypeScript(
  new URL("../src/lib/shoplingBarcodeSyncRunner.ts", import.meta.url),
);

const ENV_KEYS = [
  "SHOPLING_BARCODE_SYNC_REPO",
  "SHOPLING_BARCODE_SYNC_WORKFLOW",
  "SHOPLING_BARCODE_SYNC_REF",
  "SHOPLING_BARCODE_SYNC_ACTIONS_TOKEN",
  "GITHUB_ACTIONS_TOKEN",
  "SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN",
];

const BASE_ENV = {
  SHOPLING_BARCODE_SYNC_REPO: "andysong111/commerce-os-shopling-barcode-sync-11",
  SHOPLING_BARCODE_SYNC_WORKFLOW: "shopling-barcode-sync.yml",
  SHOPLING_BARCODE_SYNC_REF: "main",
  SHOPLING_BARCODE_SYNC_ACTIONS_TOKEN: "test-token",
};

function withEnv(env, fn) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  return Promise.resolve(fn()).finally(() => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("request id is generated and parsed safely", () => {
  const requestId = generateShoplingBarcodeSyncRequestId(
    new Date("2026-07-28T09:00:00Z"),
  );
  assert.match(requestId, /^barcode-sync-20260728T090000Z-[0-9a-f]{6}$/);
  assert.equal(isValidShoplingBarcodeSyncRequestId(requestId), true);
  assert.equal(
    parseShoplingBarcodeSyncRequestTimestamp(requestId)?.toISOString(),
    "2026-07-28T09:00:00.000Z",
  );
  assert.equal(isValidShoplingBarcodeSyncRequestId("bad request/id"), false);
});

test("run input enforces confirmation and safe goods keys", () => {
  assert.equal(
    validateShoplingBarcodeSyncRunInput({ mode: "plan" }).mode,
    "plan",
  );
  assert.throws(() =>
    validateShoplingBarcodeSyncRunInput({
      mode: "canary",
      confirm_text: "wrong",
      target_goods_keys: "117305",
    }),
  );
  assert.throws(() =>
    validateShoplingBarcodeSyncRunInput({
      mode: "retry",
      confirm_text: "실패재시도",
      target_goods_keys: "117305;rm",
    }),
  );
  const retry = validateShoplingBarcodeSyncRunInput({
    mode: "retry",
    confirm_text: "실패재시도",
    target_goods_keys: "117305, 117308\n117305",
  });
  assert.deepEqual(retry.goodsKeys, ["117305", "117308"]);
});

test("verified canary contains exactly ten known goods keys", () => {
  assert.equal(SHOPLING_BARCODE_SYNC_VERIFIED_CANARY_KEYS.length, 10);
  assert.deepEqual(
    SHOPLING_BARCODE_SYNC_VERIFIED_CANARY_KEYS.slice(0, 3),
    ["117305", "117308", "117311"],
  );
});

test("dispatch request carries exact request id and safe workflow inputs", async () => {
  await withEnv(BASE_ENV, () => {
    const request = buildShoplingBarcodeSyncDispatchRequest(
      {
        mode: "canary",
        apply_scope: "oldest_2000",
        target_goods_keys: SHOPLING_BARCODE_SYNC_VERIFIED_CANARY_KEYS.join(","),
        confirm_text: "테스트반영",
        canary_count: 10,
      },
      new Date("2026-07-28T09:00:00Z"),
    );
    assert.equal(
      request.url,
      "https://api.github.com/repos/andysong111/commerce-os-shopling-barcode-sync-11/actions/workflows/shopling-barcode-sync.yml/dispatches",
    );
    assert.equal(request.body.ref, "main");
    assert.equal(request.body.inputs.request_id, request.requestId);
    assert.equal(request.body.inputs.mode, "canary");
    assert.equal(request.body.inputs.confirm_text, "테스트반영");
    assert.equal(request.body.inputs.canary_count, "10");
  });
});

test("result summary is extracted from a nested artifact path", () => {
  const summary = {
    request_id: "barcode-sync-20260728T090000Z-abcdef",
    scanned_products: 10267,
    blocked_products: 0,
  };
  const zip = zipSync({
    "artifacts/result_summary.json": strToU8(JSON.stringify(summary)),
  });
  assert.deepEqual(extractShoplingBarcodeSyncResultSummary(zip), summary);
});

test("runs URL is scoped to workflow, branch, dispatch event and time window", async () => {
  await withEnv(BASE_ENV, () => {
    const request = buildShoplingBarcodeSyncRunsUrl(
      "barcode-sync-20260728T090000Z-abcdef",
    );
    const url = new URL(request.url);
    assert.equal(url.pathname.endsWith("/actions/workflows/shopling-barcode-sync.yml/runs"), true);
    assert.equal(url.searchParams.get("branch"), "main");
    assert.equal(url.searchParams.get("event"), "workflow_dispatch");
    assert.match(url.searchParams.get("created") || "", /2026-07-28/);
  });
});

test("exact result fetch verifies run title, artifact and summary request id", async () => {
  await withEnv(BASE_ENV, async () => {
    const requestId = "barcode-sync-20260728T090000Z-abcdef";
    const summary = {
      request_id: requestId,
      mode: "plan",
      scanned_products: 10267,
      total_options: 20126,
      collection_errors: [],
    };
    const zip = zipSync({
      "result_summary.json": strToU8(JSON.stringify(summary)),
    });
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (calls.length === 1) {
        return jsonResponse({
          workflow_runs: [
            {
              id: 123,
              status: "completed",
              conclusion: "success",
              html_url: "https://github.com/example/run/123",
              display_title: `Barcode sync · plan · oldest_2000 · ${requestId}`,
            },
          ],
        });
      }
      if (calls.length === 2) {
        return jsonResponse({
          artifacts: [
            {
              name: "shopling-barcode-sync-plan-oldest_2000-123",
              archive_download_url: "https://api.github.com/artifact.zip",
            },
          ],
        });
      }
      return new Response(zip, { status: 200 });
    };
    try {
      const result = await fetchShoplingBarcodeSyncActionsResult(requestId);
      assert.equal(result.status, "success");
      assert.equal(result.runId, 123);
      assert.equal(result.summary.request_id, requestId);
      assert.equal(calls.length, 3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("result fetch refuses a mismatched artifact request id", async () => {
  await withEnv(BASE_ENV, async () => {
    const requestId = "barcode-sync-20260728T090000Z-abcdef";
    const zip = zipSync({
      "result_summary.json": strToU8(
        JSON.stringify({ request_id: "barcode-sync-20260728T090001Z-aaaaaa" }),
      ),
    });
    const originalFetch = globalThis.fetch;
    let call = 0;
    globalThis.fetch = async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse({
          workflow_runs: [
            {
              id: 123,
              status: "completed",
              conclusion: "success",
              display_title: `Barcode sync · plan · oldest_2000 · ${requestId}`,
            },
          ],
        });
      }
      if (call === 2) {
        return jsonResponse({
          artifacts: [
            {
              name: "shopling-barcode-sync-plan-oldest_2000-123",
              archive_download_url: "https://api.github.com/artifact.zip",
            },
          ],
        });
      }
      return new Response(zip, { status: 200 });
    };
    try {
      const result = await fetchShoplingBarcodeSyncActionsResult(requestId);
      assert.equal(result.status, "error");
      assert.match(result.message || "", /request_id/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

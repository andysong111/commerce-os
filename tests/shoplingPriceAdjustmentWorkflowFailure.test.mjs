import assert from "node:assert/strict";
import test from "node:test";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const workflowStatus = await importTranspiledTypeScript(
  new URL("../src/lib/shoplingPriceAdjustmentWorkflowStatus.ts", import.meta.url),
);

async function withGithubConfig(callback) {
  const previous = {
    repo: process.env.SHOPLING_PRICE_MODIFY_REPO,
    ref: process.env.SHOPLING_PRICE_MODIFY_REF,
    token: process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN,
    fallbackToken: process.env.GITHUB_ACTIONS_TOKEN,
    fetch: globalThis.fetch,
  };
  process.env.SHOPLING_PRICE_MODIFY_REPO =
    "andysong111/shopling-price-modify-auto";
  process.env.SHOPLING_PRICE_MODIFY_REF = "main";
  process.env.SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN = "test-token";
  delete process.env.GITHUB_ACTIONS_TOKEN;
  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries({
      SHOPLING_PRICE_MODIFY_REPO: previous.repo,
      SHOPLING_PRICE_MODIFY_REF: previous.ref,
      SHOPLING_PRICE_MODIFY_ACTIONS_TOKEN: previous.token,
      GITHUB_ACTIONS_TOKEN: previous.fallbackToken,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.fetch = previous.fetch;
  }
}

test("matches the request id in a GitHub Actions display title", () => {
  const requestId = "price-adjust-plan-20260730T153334Z-9c80ad";
  assert.equal(
    workflowStatus.githubWorkflowRunMatchesRequestId(
      {
        display_title:
          `Shopling price adjustment plan ${requestId}`,
      },
      requestId,
    ),
    true,
  );
  assert.equal(
    workflowStatus.githubWorkflowRunMatchesRequestId(
      { display_title: "unrelated run" },
      requestId,
    ),
    false,
  );
});

test("detects a completed failed run with no artifact as a terminal external failure", async () =>
  withGithubConfig(async () => {
    const requestId = "price-adjust-plan-20260730T153334Z-9c80ad";
    const calls = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/runs?")) {
        return new Response(JSON.stringify({
          workflow_runs: [{
            id: 10,
            status: "completed",
            conclusion: "failure",
            display_title:
              `Shopling price adjustment plan ${requestId}`,
            html_url: "https://github.example/actions/runs/10",
            updated_at: "2026-07-30T15:34:00Z",
          }],
        }), { status: 200 });
      }
      if (url.endsWith("/actions/runs/10/artifacts")) {
        return new Response(JSON.stringify({ artifacts: [] }), {
          status: 200,
        });
      }
      throw new Error(`unexpected URL ${url}`);
    };

    const result =
      await workflowStatus.findTerminalGithubWorkflowFailure({
        requestId,
        workflow: "shopling-price-adjustment-plan.yml",
        artifactName: "shopling-price-adjustment-plan-summary",
        operationLabel: "현재가·옵션 조회",
        now: new Date("2026-07-30T15:40:00Z"),
      });

    assert.equal(result?.runId, 10);
    assert.equal(result?.conclusion, "failure");
    assert.match(result?.message ?? "", /결제 실패·Actions 사용 한도/);
    assert.equal(calls.length, 2);
  }));

test("keeps waiting when the matching run has the expected artifact", async () =>
  withGithubConfig(async () => {
    const requestId =
      "price-adjust-batch-canary-20260730T153334Z-9c80ad";
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/runs?")) {
        return new Response(JSON.stringify({
          workflow_runs: [{
            id: 11,
            status: "completed",
            conclusion: "failure",
            display_title:
              `Shopling price adjustment batch ${requestId}`,
            updated_at: "2026-07-30T15:34:00Z",
          }],
        }), { status: 200 });
      }
      if (url.endsWith("/actions/runs/11/artifacts")) {
        return new Response(JSON.stringify({
          artifacts: [{
            name: "shopling-price-adjustment-batch-canary-summary",
          }],
        }), { status: 200 });
      }
      throw new Error(`unexpected URL ${url}`);
    };

    const result =
      await workflowStatus.findTerminalGithubWorkflowFailure({
        requestId,
        workflow: "shopling-price-adjustment-batch-canary.yml",
        artifactName: "shopling-price-adjustment-batch-canary-summary",
        operationLabel: "실제 가격 변경",
        now: new Date("2026-07-30T15:40:00Z"),
      });

    assert.equal(result, null);
  }));

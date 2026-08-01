import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  cancelShoplingCategoryUpdate,
  chooseCancelableShoplingCategoryRun,
} from "../src/lib/shoplingCategoryCancel.ts";

test("request_id가 표시된 실행을 우선 취소 대상으로 고른다", () => {
  const chosen = chooseCancelableShoplingCategoryRun(
    [
      {
        id: 10,
        status: "in_progress",
        conclusion: null,
        created_at: "2026-08-01T18:00:00Z",
        display_title: "Shopling Category Refresh · other-request",
      },
      {
        id: 11,
        status: "queued",
        conclusion: null,
        created_at: "2026-08-01T17:59:00Z",
        display_title: "Shopling Category Refresh · request-123",
      },
    ],
    { requestId: "request-123", startedAt: "2026-08-01T17:58:00Z" },
  );
  assert.equal(chosen?.id, 11);
});

test("구형 run-name이면 전용 workflow의 최신 활성 실행을 고른다", () => {
  const chosen = chooseCancelableShoplingCategoryRun(
    [
      {
        id: 21,
        status: "completed",
        conclusion: "failure",
        created_at: "2026-08-01T18:03:00Z",
        display_title: "Shopling Category Refresh",
      },
      {
        id: 20,
        status: "in_progress",
        conclusion: null,
        created_at: "2026-08-01T18:02:00Z",
        display_title: "Shopling Category Refresh",
      },
    ],
    { requestId: "not-in-title", startedAt: "2026-08-01T18:00:00Z" },
  );
  assert.equal(chosen?.id, 20);
});

test("GitHub Actions 활성 실행에 실제 cancel 요청을 보낸다", async () => {
  const original = { ...process.env };
  process.env.GITHUB_ACTIONS_TOKEN = "test-token";
  process.env.SHOPLING_CATEGORY_REPO = "owner/repo";
  process.env.SHOPLING_CATEGORY_WORKFLOW = "category.yml";
  process.env.SHOPLING_CATEGORY_REF = "main";
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    if (calls.length === 1) {
      return new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 31,
              status: "in_progress",
              conclusion: null,
              created_at: "2026-08-01T18:05:00Z",
              display_title: "Shopling Category Refresh · req-31",
              html_url: "https://github.com/owner/repo/actions/runs/31",
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(null, { status: 202 });
  };
  try {
    const result = await cancelShoplingCategoryUpdate(
      { requestId: "req-31", startedAt: "2026-08-01T18:04:00Z" },
      { fetcher },
    );
    assert.equal(result.cancelled, true);
    assert.equal(result.runId, 31);
    assert.equal(calls[1].method, "POST");
    assert.match(calls[1].url, /actions\/runs\/31\/cancel$/);
  } finally {
    process.env = original;
  }
});

test("진행창과 실시간 작업 도우미 모두 취소 기능을 제공한다", async () => {
  const bridge = await readFile(
    new URL(
      "../public/product-launch-tracker-app/category-update-work-assistant-bridge.js",
      import.meta.url,
    ),
    "utf8",
  );
  const globalControl = await readFile(
    new URL("../src/components/OpsCategoryUpdateCancelControl.tsx", import.meta.url),
    "utf8",
  );
  const route = await readFile(
    new URL("../src/app/api/shopling-categories/cancel/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(bridge, /업데이트 취소/);
  assert.match(bridge, /stopImmediatePropagation/);
  assert.match(bridge, /shopling-categories\/cancel/);
  assert.match(globalControl, /shopling-category-global-cancel-button/);
  assert.match(globalControl, /샵플링 기준정보 동기화/);
  assert.match(globalControl, /clearCategoryProgress/);
  assert.match(route, /cancelShoplingCategoryUpdate/);
});

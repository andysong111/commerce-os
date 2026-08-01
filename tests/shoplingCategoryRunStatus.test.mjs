import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fetchShoplingCategoryRunState } from "../src/lib/shoplingCategoryRunStatus.ts";

function withEnv(callback) {
  const original = { ...process.env };
  process.env.GITHUB_ACTIONS_TOKEN = "test-token";
  process.env.SHOPLING_CATEGORY_REPO = "owner/repo";
  process.env.SHOPLING_CATEGORY_WORKFLOW = "category.yml";
  process.env.SHOPLING_CATEGORY_REF = "main";
  return Promise.resolve()
    .then(callback)
    .finally(() => {
      process.env = original;
    });
}

test("request_id가 일치하는 실행의 완료 상태를 읽는다", async () => {
  await withEnv(async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 41,
              status: "completed",
              conclusion: "success",
              created_at: "2026-08-01T19:00:00Z",
              updated_at: "2026-08-01T19:12:00Z",
              display_title: "Shopling Category Refresh · request-41",
              html_url: "https://github.com/owner/repo/actions/runs/41",
            },
          ],
        }),
        { status: 200 },
      );
    const result = await fetchShoplingCategoryRunState(
      { requestId: "request-41", startedAt: "2026-08-01T18:59:00Z" },
      { fetcher },
    );
    assert.equal(result.runId, 41);
    assert.equal(result.terminal, true);
    assert.equal(result.active, false);
    assert.equal(result.conclusion, "success");
  });
});

test("실행 중인 카테고리 workflow를 running으로 구분한다", async () => {
  await withEnv(async () => {
    const fetcher = async () =>
      new Response(
        JSON.stringify({
          workflow_runs: [
            {
              id: 42,
              status: "in_progress",
              conclusion: null,
              created_at: "2026-08-01T19:20:00Z",
              updated_at: "2026-08-01T19:21:00Z",
              display_title: "Shopling Category Refresh · request-42",
              html_url: "https://github.com/owner/repo/actions/runs/42",
            },
          ],
        }),
        { status: 200 },
      );
    const result = await fetchShoplingCategoryRunState(
      { requestId: "request-42" },
      { fetcher },
    );
    assert.equal(result.active, true);
    assert.equal(result.terminal, false);
    assert.equal(result.status, "in_progress");
  });
});

test("상태 API는 Actions 성공과 스냅샷 저장 성공을 구분한다", async () => {
  const route = await readFile(
    new URL("../src/app/api/shopling-categories/status/route.ts", import.meta.url),
    "utf8",
  );
  const refresh = await readFile(
    new URL("../src/app/api/shopling-categories/refresh/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /카테고리 스냅샷이 main에 저장되지 않았습니다/);
  assert.match(route, /fetchShoplingCategoryRunState/);
  assert.match(refresh, /commerce_os_shopling_category_run/);
  assert.match(refresh, /Set-Cookie/);
});

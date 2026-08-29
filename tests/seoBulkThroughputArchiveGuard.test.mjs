import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("SEO 대량 RUN은 한 worker pulse에서 최대 4건을 병렬 처리한다", async () => {
  const cron = await source("src/app/api/cron/seo-run-worker/route.ts");
  const api = await source("src/app/api/seo-run-jobs/route.ts");
  const pulse = await source("src/lib/seoRunWorkerPulse.ts");

  assert.match(cron, /const SEO_RUN_BUSY_MAX_JOBS = 4/);
  assert.match(cron, /maxJobs: SEO_RUN_BUSY_MAX_JOBS/);
  assert.match(api, /const SEO_RUN_BUSY_MAX_JOBS = 4/);
  assert.match(
    api,
    /Math\.max\(1, Math\.min\(SEO_RUN_BUSY_MAX_JOBS, maxJobs\)\)/,
  );
  assert.match(pulse, /const SEO_RUN_BUSY_MAX_JOBS = 4/);
  assert.match(pulse, /options\.maxJobs \?\? SEO_RUN_BUSY_MAX_JOBS/);
});

test("일반 Shopling 일괄등록은 실패 RUN을 자동 재시도하지 않고 명시 재시도만 허용한다", async () => {
  const api = await source("src/app/api/seo-run-jobs/route.ts");
  const panel = await source(
    "src/app/seo-bulk-cloud/SeoBulkRegistrationFailurePanel.tsx",
  );
  const retryAll = await source(
    "src/app/seo-bulk-cloud/SeoBulkRegistrationRetryAllControl.tsx",
  );

  assert.match(api, /const retryFailed = body\.retryFailed === true/);
  assert.match(api, /job\.registration_status === "failed"/);
  assert.match(api, /return retryFailed/);
  assert.match(api, /일반 일괄등록에서 제외했습니다/);
  assert.match(panel, /retryFailed: true/);
  assert.match(retryAll, /retryFailed: true/);
});

test("보관 성공 건수는 활성 등록완료와 별도 누적 통계로 표시한다", async () => {
  const page = await source("src/app/seo-bulk-cloud/page.tsx");
  const summary = await source(
    "src/app/seo-bulk-cloud/SeoBulkArchiveSummary.tsx",
  );

  assert.match(page, /SeoBulkArchiveSummary/);
  assert.match(summary, /includeArchived=true/);
  assert.match(summary, /registration_status === "success"/);
  assert.match(summary, /Boolean\(run\.archived_at\)/);
  assert.match(summary, /보관완료 누적/);
  assert.match(summary, /현재 활성 목록만 계산합니다/);
});

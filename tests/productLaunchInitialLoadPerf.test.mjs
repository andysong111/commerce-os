import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);
const route = await readFile(
  new URL("../src/app/api/product-launch-tracker/optimized/route.ts", import.meta.url),
  "utf8",
);
const normalizedRoute = await readFile(
  new URL(
    "../src/app/api/product-launch-tracker/normalized-optimized/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const detailJobsRoute = await readFile(
  new URL(
    "../src/app/api/product-launch-tracker/detail-page-jobs/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const hotpathMigration = await readFile(
  new URL(
    "../supabase/migrations/202608160001_ops_read_hotpath_indexes.sql",
    import.meta.url,
  ),
  "utf8",
);

test("초기 목록 로딩은 요청을 강제 중단하거나 전역 fetch를 교체하지 않는다", () => {
  assert.doesNotMatch(app, /optimized-page-fetch-guard\.js/);
  assert.doesNotMatch(app, /window\.fetch\s*=/);
  assert.match(app, /목록 응답 지연 · 서버 응답을 기다리는 중/);
  assert.match(app, /await import\("\.\/optimized-app\.js"\)/);
});

test("콜드 캐시는 timestamp 선조회 없이 전체 상태를 한 번만 읽는다", () => {
  const coldStart = route.indexOf("if (!existing) {");
  const fullRead = route.indexOf("return loadAndCacheFullState(config, ownerId);", coldStart);
  const stampRead = route.indexOf("const stamp = await readStateStamp(config, ownerId);", coldStart);
  assert.ok(coldStart >= 0);
  assert.ok(fullRead > coldStart);
  assert.ok(stampRead > fullRead);
});

test("상품출시 목록은 정규화 DB를 직접 읽고 stale-while-revalidate로 이전 정상 목록을 즉시 반환한다", () => {
  const pageBranch = normalizedRoute.indexOf('if (mode === "page")');
  const strictAvailability = normalizedRoute.indexOf(
    "loadFreshProductLaunchNormalized(request)",
  );
  assert.ok(pageBranch >= 0);
  assert.ok(strictAvailability > pageBranch);
  assert.match(normalizedRoute, /return getNormalizedPage\(request\)/);
  assert.match(normalizedRoute, /PAGE_CACHE_TTL_MS = 10_000/);
  assert.match(normalizedRoute, /PAGE_CACHE_STALE_MS = 60_000/);
  assert.match(normalizedRoute, /stale-while-revalidate/);
  assert.match(normalizedRoute, /after\(async \(\) =>/);
  assert.match(normalizedRoute, /readProductLaunchNormalizedWorkspace/);
  assert.match(normalizedRoute, /queryProductLaunchNormalizedPage/);
  assert.match(normalizedRoute, /PRODUCT_LAUNCH_LIST_TEMPORARILY_UNAVAILABLE/);
});

test("상세페이지 작업 폴링도 짧은 DB 재조회 대신 stale 캐시를 공유한다", () => {
  assert.match(detailJobsRoute, /JOB_LIST_CACHE_TTL_MS = 8_000/);
  assert.match(detailJobsRoute, /JOB_LIST_STALE_TTL_MS = 60_000/);
  assert.match(detailJobsRoute, /cached\.staleUntil > now/);
  assert.match(detailJobsRoute, /after\(async \(\) =>/);
  assert.match(detailJobsRoute, /background refresh failed/);
});

test("Supabase hot read indexes match detail-page polling and Stage8 operation queries", () => {
  assert.match(
    hotpathMigration,
    /product_launch_upload_jobs_detail_page_owner_updated_idx/,
  );
  assert.match(
    hotpathMigration,
    /product_launch_upload_jobs \(owner_id, updated_at desc\)/,
  );
  assert.match(hotpathMigration, /payload->>'kind'\) = 'detail_page'/);
  assert.match(hotpathMigration, /commerce_operation_runs_type_started_idx/);
  assert.match(
    hotpathMigration,
    /commerce_operation_runs \(operation_type, started_at desc\)/,
  );
});

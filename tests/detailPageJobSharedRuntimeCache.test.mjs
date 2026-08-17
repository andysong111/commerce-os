import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL(
    "../src/app/api/product-launch-tracker/detail-page-jobs/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("detail page job reads use Vercel/Next shared runtime cache", () => {
  assert.match(route, /import \{ unstable_cache \} from "next\/cache"/);
  assert.match(route, /SHARED_JOB_LIST_REVALIDATE_SECONDS = 10/);
  assert.match(route, /const sharedDetailPageJobs = unstable_cache/);
  assert.match(route, /\["detail-page-job-list-shared-v1"\]/);
  assert.match(route, /revalidate: SHARED_JOB_LIST_REVALIDATE_SECONDS/);
});

test("existing in-instance stale-while-revalidate remains in front of shared cache", () => {
  assert.match(route, /const request = sharedDetailPageJobs\(ownerId, normalizedQuery\)/);
  assert.match(route, /JOB_LIST_STALE_TTL_MS = 60_000/);
  assert.match(route, /after\(async \(\) =>/);
});

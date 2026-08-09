import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const assetRoute = readFileSync(
  new URL(
    "../src/app/api/product-launch-tracker/detail-page-assets/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("detail-page asset uploads retry transient database and storage failures", () => {
  assert.match(assetRoute, /const TRANSIENT_ATTEMPTS = 3/);
  assert.match(assetRoute, /connection to the database timed out/);
  assert.match(assetRoute, /storageRequestWithRetry/);
  assert.match(assetRoute, /status === 429/);
  assert.match(assetRoute, /status >= 500/);
  assert.match(assetRoute, /await retryDelay\(attempt\)/);
});

test("worker job lookup retries the same transient database timeout before failing the paid generation", () => {
  assert.match(assetRoute, /readDetailPageJobWithRetry\(config\.value, jobId\)/);
  assert.match(assetRoute, /return await readDetailPageJob\(config, jobId\)/);
  assert.match(assetRoute, /isTransientDatabaseFailure\(error\)/);
});

test("known public bucket readiness is cached within a warm function instance", () => {
  assert.match(assetRoute, /let publicBucketReady = false/);
  assert.match(assetRoute, /if \(publicBucketReady\) return \{ ok: true as const \}/);
  assert.match(assetRoute, /publicBucketReady = true/);
});

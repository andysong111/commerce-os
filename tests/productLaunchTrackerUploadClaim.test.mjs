import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Shopling 업로드 Worker는 queued 작업을 정확히 한 번만 claim한다", async () => {
  const route = await readFile(
    new URL("../src/app/api/product-launch-tracker/upload-jobs/[jobId]/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /SHOPLING_JOB_NOT_CLAIMABLE/);
  assert.match(route, /SHOPLING_JOB_ALREADY_CLAIMED/);
  assert.match(route, /status: "eq\.queued"/);
  assert.match(route, /Prefer: "return=representation"/);
  assert.match(route, /SHOPLING_JOB_CALLBACK_NOT_ACCEPTED/);
  assert.match(route, /SHOPLING_JOB_REQUEST_ID_MISMATCH/);
  assert.match(route, /String\(job\.status \?\? ""\) !== "running"/);
});

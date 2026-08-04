import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  detailPageClaimDecision,
  detailPageDispatchDecision,
  nextDetailPageMutationTimestamp,
} from "../src/lib/detailPageJobConcurrency.ts";

const serverSource = await readFile(
  "src/lib/detailPageJobServer.ts",
  "utf8",
);
const startRouteSource = await readFile(
  "src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/start/route.ts",
  "utf8",
);
const jobRouteSource = await readFile(
  "src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/route.ts",
  "utf8",
);

const now = Date.parse("2026-08-05T04:00:00.000Z");

test("only the first active execution may reserve a Studio worker dispatch", () => {
  assert.deepEqual(
    detailPageDispatchDecision(
      {
        status: "queued",
        lease_owner: "",
        payload: {
          execution_id: "execution-1",
          worker_dispatch_id: "dispatch-1",
          worker_dispatch_execution_id: "execution-1",
          worker_dispatch_until: "2026-08-05T04:01:00.000Z",
        },
      },
      now,
    ),
    { action: "skip", reason: "dispatch_active" },
  );

  assert.deepEqual(
    detailPageDispatchDecision(
      {
        status: "queued",
        lease_owner: "worker-1",
        lease_until: "2026-08-05T04:07:00.000Z",
        payload: { execution_id: "execution-1" },
      },
      now,
    ),
    { action: "skip", reason: "lease_active" },
  );
});

test("expired or previous-execution dispatch markers do not block new work", () => {
  assert.deepEqual(
    detailPageDispatchDecision(
      {
        status: "queued",
        payload: {
          execution_id: "execution-2",
          worker_dispatch_id: "dispatch-old",
          worker_dispatch_execution_id: "execution-1",
          worker_dispatch_until: "2026-08-05T04:01:00.000Z",
        },
      },
      now,
    ),
    { action: "reserve" },
  );
  assert.deepEqual(
    detailPageDispatchDecision(
      {
        status: "queued",
        payload: {
          execution_id: "execution-1",
          worker_dispatch_id: "dispatch-expired",
          worker_dispatch_execution_id: "execution-1",
          worker_dispatch_until: "2026-08-05T03:59:59.000Z",
        },
      },
      now,
    ),
    { action: "reserve" },
  );
});

test("an active worker lease can be renewed only by the same worker", () => {
  const active = {
    status: "running",
    lease_owner: "worker-1",
    lease_until: "2026-08-05T04:07:00.000Z",
  };
  assert.deepEqual(detailPageClaimDecision(active, "worker-2", now), {
    action: "skip",
    reason: "lease_active",
  });
  assert.deepEqual(detailPageClaimDecision(active, "worker-1", now), {
    action: "claim",
  });
  assert.deepEqual(
    detailPageClaimDecision({ status: "failed" }, "worker-1", now),
    { action: "skip", reason: "terminal" },
  );
});

test("optimistic-lock timestamps always advance", () => {
  assert.equal(
    nextDetailPageMutationTimestamp("2026-08-05T04:00:00.000Z", now),
    "2026-08-05T04:00:00.001Z",
  );
  assert.equal(
    nextDetailPageMutationTimestamp("2026-08-05T03:59:00.000Z", now),
    "2026-08-05T04:00:00.000Z",
  );
});

test("start reservations and worker claims use one-row compare-and-swap wiring", () => {
  assert.match(startRouteSource, /reserveDetailPageJobDispatch/);
  assert.match(startRouteSource, /duplicate dispatch skipped/);
  assert.match(jobRouteSource, /claimDetailPageJobLease/);
  assert.match(jobRouteSource, /worker_dispatch_id: ""/);
  assert.match(serverSource, /updated_at: `eq\.\$\{current\.updated_at\}`/);
  assert.match(serverSource, /"payload->>kind": "eq\.detail_page"/);
  assert.match(serverSource, /patchDetailPageJobIfUnchanged/);
  assert.match(serverSource, /worker_dispatch_until/);
});

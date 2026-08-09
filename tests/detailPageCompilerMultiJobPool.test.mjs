import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE,
  detailPageWorkerSlot,
} from "../src/lib/detailPageCompilerWorkerPool.ts";

const control = await readFile(
  new URL(
    "../src/components/product-launch-flow/ProductLaunchEvidenceCompilerCanary.tsx",
    import.meta.url,
  ),
  "utf8",
);
const jobsRoute = await readFile(
  new URL("../src/app/api/product-launch-tracker/detail-page-jobs/route.ts", import.meta.url),
  "utf8",
);
const parallelWorkers = await readFile(
  new URL("../src/components/DetailPageCompilerParallelWorkers.tsx", import.meta.url),
  "utf8",
);
const appShell = await readFile(
  new URL("../src/components/AppShell.tsx", import.meta.url),
  "utf8",
);
const dock = await readFile(
  new URL("../public/product-launch-tracker-app/detail-page-dock.js", import.meta.url),
  "utf8",
);

test("Compiler pool has three deterministic fallback collection slots", () => {
  assert.equal(DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE, 3);
  for (const itemId of ["launch-2458-aaa489", "launch-2450-aaa475", "launch-2440-aaa467", "launch-2454-aaa477"]) {
    const first = detailPageWorkerSlot(itemId);
    const second = detailPageWorkerSlot(itemId);
    assert.equal(first, second);
    assert.ok(first >= 0 && first < DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE);
  }
});

test("Product Launch Compiler control accepts multiple selected products and round-robins the first three slots", () => {
  assert.match(control, /Evidence Compiler v1 · 다중 신규 생성/);
  assert.match(control, /if \(!selectedIds\.length\)/);
  assert.doesNotMatch(control, /selectedIds\.length !== 1/);
  assert.match(control, /mapWithConcurrency/);
  assert.match(control, /compilerCanary: true/);
  assert.match(control, /compilerWorkerSlot = batchIndex % DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE/);
  assert.match(control, /compilerWorkerSlot,/);
  assert.match(control, /체크 상품 Compiler 생성/);
});

test("durable Compiler job persists its explicit collection worker slot", () => {
  assert.match(jobsRoute, /compilerWorkerSlot: number \| null/);
  assert.match(jobsRoute, /compiler_worker_slot: input\.compilerWorkerSlot/);
  assert.match(jobsRoute, /requestedCompilerSlot >= 0/);
  assert.match(jobsRoute, /requestedCompilerSlot < COMPILER_WORKER_SLOT_COUNT/);
});

test("AppShell mounts two extra hidden Compiler workers while primary worker remains in OpsWorkAssistant", () => {
  assert.match(appShell, /DetailPageCompilerParallelWorkers/);
  assert.match(parallelWorkers, /DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE - 1/);
  assert.match(parallelWorkers, /compiler_worker_slot=\$\{slot\}/);
  assert.match(parallelWorkers, /compiler_worker_slots=\$\{DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE\}/);
});

test("worker sharding is Compiler-only, prefers persisted slot, and keeps v3 on primary worker", () => {
  assert.match(dock, /COMPILER_WORKER_EXPLICIT/);
  assert.match(dock, /job\?\.payload\?\.compiler_canary === true/);
  assert.match(dock, /if \(!isCompilerJob\(job\)\) return !COMPILER_WORKER_EXPLICIT/);
  assert.match(dock, /function persistedCompilerWorkerSlot\(job\)/);
  assert.match(dock, /persistedSlot \?\? compilerWorkerSlotForItem\(job\?\.itemId\)/);
  assert.match(dock, /workerOwnsJob\(job\)/);
  assert.match(dock, /!workerOwnsJob\(server\)/);
});

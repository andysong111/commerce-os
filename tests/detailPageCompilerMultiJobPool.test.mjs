import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE,
  detailPageWorkerSlot,
} from "../src/lib/detailPageCompilerWorkerPool.ts";

const control = await readFile(
  new URL("../src/components/product-launch-flow/ProductLaunchEvidenceCompilerCanary.tsx", import.meta.url),
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

test("archived Compiler pool remains deterministic for historical jobs", () => {
  assert.equal(DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE, 3);
  for (const itemId of ["launch-2458-aaa489", "launch-2450-aaa475", "launch-2440-aaa467"]) {
    const first = detailPageWorkerSlot(itemId);
    const second = detailPageWorkerSlot(itemId);
    assert.equal(first, second);
    assert.ok(first >= 0 && first < DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE);
  }
});

test("Compiler controls and workers remain archived in code but are not mounted in production UI", () => {
  assert.match(control, /Evidence Compiler v1 · 다중 신규 생성/);
  assert.match(parallelWorkers, /DETAIL_PAGE_COMPILER_WORKER_POOL_SIZE - 1/);
  assert.doesNotMatch(appShell, /DetailPageCompilerParallelWorkers/);
});

test("historical Compiler worker sharding code remains isolated from normal v3 jobs", () => {
  assert.match(dock, /job\?\.payload\?\.compiler_canary === true/);
  assert.match(dock, /if \(!isCompilerJob\(job\)\) return !COMPILER_WORKER_EXPLICIT/);
  assert.match(dock, /workerOwnsJob\(job\)/);
});

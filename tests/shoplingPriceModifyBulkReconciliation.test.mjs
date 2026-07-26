import test from "node:test";
import assert from "node:assert/strict";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const { decideNormalDispatchingReconciliation } = await importTranspiledTypeScript(
  new URL("../src/lib/shoplingPriceModifyBulkReconciliation.ts", import.meta.url),
);

const now = Date.parse("2026-07-26T16:12:00Z");
test("normal dispatching reconciliation observes the 120 second boundary", () => {
  assert.equal(decideNormalDispatchingReconciliation({ chunkStatus: "dispatching", startedAt: new Date(now - 119_000).toISOString(), now }), "wait");
  assert.equal(decideNormalDispatchingReconciliation({ chunkStatus: "dispatching", startedAt: new Date(now - 120_000).toISOString(), now }), "block_uncertain");
  assert.equal(decideNormalDispatchingReconciliation({ chunkStatus: "dispatching", startedAt: null, now }), "block_uncertain");
  assert.equal(decideNormalDispatchingReconciliation({ chunkStatus: "running", startedAt: null, now }), "none");
  assert.equal(decideNormalDispatchingReconciliation({ chunkStatus: "dispatch_uncertain", startedAt: null, now }), "none");
});

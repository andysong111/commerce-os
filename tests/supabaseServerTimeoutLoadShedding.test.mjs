import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Ops Supabase admin reads fail fast before a Vercel invocation can hang", async () => {
  const admin = await source("src/lib/supabase/admin.ts");

  assert.match(admin, /SUPABASE_ADMIN_READ_TIMEOUT_MS = 5_000/);
  assert.match(admin, /SUPABASE_ADMIN_WRITE_TIMEOUT_MS = 12_000/);
  assert.match(admin, /SUPABASE_ADMIN_RPC_TIMEOUT_MS = 12_000/);
  assert.match(admin, /signal: AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(admin, /signal: AbortSignal\.timeout\(SUPABASE_ADMIN_RPC_TIMEOUT_MS\)/);
  assert.match(admin, /Supabase REST timeout after/);
  assert.match(admin, /adminTransportError/);
});

test("duplicate DB HTTP wakeup is retired and one Vercel dispatcher owns every schedule", async () => {
  const retirement = await source(
    "supabase/migrations/202608280008_optimize_seo_claim_and_remove_duplicate_wakeup.sql",
  );
  const scheduler = await source(
    "supabase/migrations/202608280009_ops_adaptive_dispatcher.sql",
  );
  const vercel = JSON.parse(await source("vercel.json"));

  assert.match(retirement, /cron\.unschedule/);
  assert.doesNotMatch(retirement, /cron\.schedule\s*\(/);
  assert.doesNotMatch(retirement, /net\.http_get/);
  assert.match(scheduler, /claim_next_ops_dispatch_task/);
  assert.match(scheduler, /wake_ops_dispatch_task/);
  assert.deepEqual(vercel.crons, [
    { path: "/api/cron/ops-dispatcher", schedule: "* * * * *" },
  ]);
});

test("SEO pulse lease RPCs are also bounded by the shared admin timeout", async () => {
  const control = await source("src/lib/seoRunWorkerControl.ts");
  assert.match(control, /SUPABASE_ADMIN_RPC_TIMEOUT_MS/);
  assert.match(control, /AbortSignal\.timeout\(SUPABASE_ADMIN_RPC_TIMEOUT_MS\)/);
});

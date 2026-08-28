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

test("duplicate Supabase SEO HTTP wakeup is retired while Vercel keeps bounded durable recovery", async () => {
  const migration = await source(
    "supabase/migrations/202608280008_optimize_seo_claim_and_remove_duplicate_wakeup.sql",
  );
  const vercel = JSON.parse(await source("vercel.json"));

  assert.match(migration, /cron\.unschedule/);
  assert.doesNotMatch(migration, /cron\.schedule\s*\(/);
  assert.doesNotMatch(migration, /net\.http_get/);

  assert.deepEqual(
    vercel.crons.find((row) => row.path === "/api/cron/seo-run-worker"),
    {
      path: "/api/cron/seo-run-worker",
      schedule: "1,6,11,16,21,26,31,36,41,46,51,56 * * * *",
    },
  );
});

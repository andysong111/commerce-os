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

test("Supabase SEO wakeup remains a bounded fallback while Vercel stays the primary minute worker", async () => {
  const migration = await source(
    "supabase/migrations/202608280007_reduce_seo_run_supabase_wakeup_pressure.sql",
  );
  const vercel = JSON.parse(await source("vercel.json"));

  assert.match(migration, /cron\.unschedule/);
  assert.match(migration, /'\*\/5 \* \* \* \*'/);
  assert.match(migration, /timeout_milliseconds := 15000/);
  assert.doesNotMatch(migration, /280000/);

  assert.deepEqual(
    vercel.crons.find((row) => row.path === "/api/cron/seo-run-worker"),
    {
      path: "/api/cron/seo-run-worker",
      schedule: "* * * * *",
    },
  );
});

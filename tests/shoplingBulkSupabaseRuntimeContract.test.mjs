import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Bulk Supabase runtime contract keeps login and admin loading separate", async () => {
  const [admin, server] = await Promise.all([
    readFile(new URL("../src/lib/supabase/admin.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/supabase/server.ts", import.meta.url), "utf8"),
  ]);
  assert.match(server, /createServerClient/);
  assert.match(admin, /SUPABASE_SECRET_KEY/);
  assert.match(admin, /await import\("@supabase\/supabase-js"\)/);
  assert.doesNotMatch(admin, /Function\(/);
});

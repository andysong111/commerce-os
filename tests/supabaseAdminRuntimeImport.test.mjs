import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Supabase admin loader uses a bundler-visible literal dynamic import", async () => {
  const source = await readFile(new URL("../src/lib/supabase/admin.ts", import.meta.url), "utf8");
  assert.match(source, /await import\("@supabase\/supabase-js"\)/);
  assert.doesNotMatch(source, /Function\(|dynamicImportSupabaseJs/);
  assert.match(source, /SUPABASE_SECRET_KEY/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Supabase admin client uses a bundled static import and accepts both server key names", async () => {
  const source = await readFile(new URL("../src/lib/supabase/admin.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ createClient \} from "@supabase\/supabase-js"/);
  assert.match(source, /SUPABASE_SECRET_KEY/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /Function\(|dynamicImportSupabaseJs|return import\(specifier\)/);
});

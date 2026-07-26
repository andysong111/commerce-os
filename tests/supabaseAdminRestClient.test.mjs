import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Supabase admin client uses server-side REST without runtime package imports", async () => {
  const source = await readFile(new URL("../src/lib/supabase/admin.ts", import.meta.url), "utf8");
  assert.match(source, /\/rest\/v1\/rpc\//);
  assert.match(source, /Authorization: `Bearer \$\{secretKey\}`/);
  assert.match(source, /apikey: secretKey/);
  assert.match(source, /SUPABASE_SECRET_KEY/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /@supabase\/supabase-js|Function\(|dynamicImportSupabaseJs/);
});

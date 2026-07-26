import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Bulk Supabase admin loader has no computed package import", async () => {
  const source = await readFile(new URL("../src/lib/supabase/admin.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /return import\(specifier\)|Function\(/);
});

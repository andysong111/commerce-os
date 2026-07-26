import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Supabase admin import is literal and server-only", async () => {
  const source = await readFile(new URL("../src/lib/supabase/admin.ts", import.meta.url), "utf8");
  assert.equal(source.includes('await import("@supabase/supabase-js")'), true);
  assert.equal(source.includes('Function("specifier"'), false);
});

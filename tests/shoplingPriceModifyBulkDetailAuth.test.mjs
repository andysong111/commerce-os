import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("bulk job detail uses the shared temporary Ops session and owner scope", async () => {
  const route = await read("src/app/api/shopling-price-modify/bulk/jobs/[jobId]/route.ts");

  assert.match(route, /normalSession\(request\)/);
  assert.match(route, /\.eq\("owner_id", auth\.ownerId\)/);
  assert.doesNotMatch(route, /createSupabaseServerClient|createSupabaseAdminClient|auth\.getUser/);
});

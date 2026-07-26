import assert from "node:assert/strict";
import test from "node:test";
import { createSupabaseAdminHeaders } from "../src/lib/supabase/admin.ts";

test("new Supabase secret keys are sent only through apikey", () => {
  const headers = createSupabaseAdminHeaders("sb_secret_example");
  assert.equal(headers.apikey, "sb_secret_example");
  assert.equal(headers.Authorization, undefined);
});

test("legacy service_role JWT keeps the bearer header", () => {
  const headers = createSupabaseAdminHeaders("eyJlegacy.service.role");
  assert.equal(headers.apikey, "eyJlegacy.service.role");
  assert.equal(headers.Authorization, "Bearer eyJlegacy.service.role");
});

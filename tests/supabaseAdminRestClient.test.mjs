import assert from "node:assert/strict";
import test from "node:test";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const { createSupabaseAdminClient, createSupabaseAdminHeaders } = await importTranspiledTypeScript(
  new URL("../src/lib/supabase/admin.ts", import.meta.url),
);

const withMockedAdmin = async (handler) => {
  const previous = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, secret: process.env.SUPABASE_SECRET_KEY, fetch: globalThis.fetch };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "legacy.service-role.secret";
  try { await handler(); }
  finally {
    if (previous.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url;
    if (previous.secret === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previous.secret;
    globalThis.fetch = previous.fetch;
  }
};

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

test("admin query executes PostgREST in, order and limit filters with GET auth policy", async () => {
  await withMockedAdmin(async () => {
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url: String(url), init };
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    };
    const admin = await createSupabaseAdminClient();
    const result = await admin.from("shopling_price_bulk_chunks").select("id,status").eq("job_id", "job-1")
      .in("status", ["running", "dispatch_uncertain"]).order("chunk_index", { ascending: true }).limit(2);

    assert.equal(result.error, null);
    assert.equal(request.init.method, "GET");
    assert.equal(request.init.headers.apikey, "legacy.service-role.secret");
    assert.equal(request.init.headers.Authorization, "Bearer legacy.service-role.secret");
    assert.equal(request.url.includes("legacy.service-role.secret"), false);
    const url = new URL(request.url);
    assert.equal(url.searchParams.get("status"), "in.(running,dispatch_uncertain)");
    assert.equal(url.searchParams.get("order"), "chunk_index.asc");
    assert.equal(url.searchParams.get("limit"), "2");
  });
});

test("in filter quotes special values and rejects an empty value list", async () => {
  await withMockedAdmin(async () => {
    const admin = await createSupabaseAdminClient();
    let fetchCalled = false;
    globalThis.fetch = async () => { fetchCalled = true; return new Response("[]"); };
    assert.throws(() => admin.from("items").select().in("status", []), /at least one value/);
    assert.equal(fetchCalled, false);
    globalThis.fetch = async (url) => {
      assert.equal(new URL(String(url)).searchParams.get("status"), 'in.("needs,review","say\\"hello")');
      return new Response("[]", { status: 200 });
    };
    await admin.from("items").select().in("status", ["needs,review", 'say"hello']);
  });
});

for (const [contentRange, expectedCount] of [["0-0/17", 17], ["*/0", 0]]) {
  test(`exact HEAD query parses ${contentRange} as count ${expectedCount}`, async () => {
    await withMockedAdmin(async () => {
      globalThis.fetch = async (_url, init) => {
        assert.equal(init.method, "HEAD");
        assert.equal(init.headers.Prefer, "count=exact");
        return new Response(null, { status: 200, headers: { "content-range": contentRange } });
      };
      const admin = await createSupabaseAdminClient();
      const result = await admin.from("shopling_price_bulk_items").select("goods_key", { count: "exact", head: true })
        .eq("job_id", "job-1").eq("status", "succeeded");
      assert.equal(result.count, expectedCount);
      assert.equal(result.data, null);
      assert.equal(result.error, null);
    });
  });
}

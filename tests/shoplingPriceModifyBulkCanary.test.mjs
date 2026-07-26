import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

async function importCanaryModule() {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const temporaryDirectory = await mkdtemp(join(testDirectory, ".bulk-canary-"));
  try {
    const runnerStub = `
      export function isValidShoplingPriceModifyRequestId(value) { return /^[A-Za-z0-9._:-]{1,120}$/.test(value); }
      export function buildShoplingPriceModifyDispatchRequest(goodsKeyInput, policyOverrides) {
        return {
          url: "https://api.github.test/dispatches",
          githubActionsUrl: "https://github.test/actions",
          token: "secret-token",
          requestId: "generated-id",
          body: { ref: "main", inputs: { goods_keys: goodsKeyInput, request_id: "generated-id", policy_overrides_json: JSON.stringify(policyOverrides ?? []) } },
        };
      }
    `;
    await writeFile(join(temporaryDirectory, "shoplingPriceModifyRunner.mjs"), runnerStub, "utf8");
    const source = (await readFile(new URL("../src/lib/shoplingPriceModifyBulkCanary.ts", import.meta.url), "utf8"))
      .replace('"@/lib/shoplingPriceModifyRunner"', '"./shoplingPriceModifyRunner.mjs"');
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: "shoplingPriceModifyBulkCanary.ts",
      reportDiagnostics: true,
    });
    const errors = output.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
    assert.deepEqual(errors, []);
    await writeFile(join(temporaryDirectory, "shoplingPriceModifyBulkCanary.mjs"), output.outputText, "utf8");
    return await import(pathToFileURL(join(temporaryDirectory, "shoplingPriceModifyBulkCanary.mjs")));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const { analyzeShoplingPriceBulkCanaryResult, dispatchShoplingPriceBulkCanary } = await importCanaryModule();

const expectedKeys = ["101", "102", "103"];

test("canary analysis accepts only exact successful result", () => {
  assert.deepEqual(
    analyzeShoplingPriceBulkCanaryResult({ request_id: "req-1", goods_keys: expectedKeys, status: "success", fail_count: 0 }, "req-1", expectedKeys, "success"),
    { success: true, failedKeys: [], failureScopeKnown: true, message: "카나리 가격설정이 성공했습니다." },
  );
  assert.equal(analyzeShoplingPriceBulkCanaryResult({ request_id: "other", status: "success", fail_count: 0 }, "req-1", expectedKeys, "success").success, false);
  assert.equal(analyzeShoplingPriceBulkCanaryResult({ request_id: "req-1", goods_keys: ["999"], status: "success", fail_count: 0 }, "req-1", expectedKeys, "success").success, false);
});

test("canary analysis identifies explicit failed goods keys and blocks unknown scope", () => {
  const explicit = analyzeShoplingPriceBulkCanaryResult({
    request_id: "req-1",
    status: "failed",
    fail_count: 2,
    errors: [{ goods_key: "102" }, { goods_key: "102" }],
  }, "req-1", expectedKeys, "failure");
  assert.equal(explicit.success, false);
  assert.deepEqual(explicit.failedKeys, ["102"]);
  assert.equal(explicit.failureScopeKnown, true);

  const unknown = analyzeShoplingPriceBulkCanaryResult({ request_id: "req-1", status: "failed", fail_count: 2 }, "req-1", expectedKeys, "failure");
  assert.equal(unknown.success, false);
  assert.deepEqual(unknown.failedKeys, []);
  assert.equal(unknown.failureScopeKnown, false);
});

test("canary dispatch classifies accepted, rejected, and uncertain responses", async () => {
  const oldEnabled = process.env.SHOPLING_PRICE_MODIFY_ENABLED;
  const oldFetch = globalThis.fetch;
  process.env.SHOPLING_PRICE_MODIFY_ENABLED = "1";
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.inputs.request_id, "req-1");
      assert.equal(String(init.headers.Authorization).includes("secret-token"), true);
      return new Response(null, { status: 204 });
    };
    assert.equal((await dispatchShoplingPriceBulkCanary(expectedKeys, [], "req-1")).status, "queued");

    globalThis.fetch = async () => new Response("", { status: 422 });
    assert.equal((await dispatchShoplingPriceBulkCanary(expectedKeys, [], "req-2")).status, "rejected");

    globalThis.fetch = async () => new Response("", { status: 500 });
    assert.equal((await dispatchShoplingPriceBulkCanary(expectedKeys, [], "req-3")).status, "uncertain");

    globalThis.fetch = async () => { throw new Error("network"); };
    assert.equal((await dispatchShoplingPriceBulkCanary(expectedKeys, [], "req-4")).status, "uncertain");
  } finally {
    globalThis.fetch = oldFetch;
    if (oldEnabled === undefined) delete process.env.SHOPLING_PRICE_MODIFY_ENABLED;
    else process.env.SHOPLING_PRICE_MODIFY_ENABLED = oldEnabled;
  }
});

test("phase 3 migration and routes enforce manual canary-only execution", async () => {
  const [migration, dispatchRoute, resultRoute, detailRoute, ui] = await Promise.all([
    readFile(new URL("../supabase/migrations/202607260002_shopling_price_bulk_canary.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/shopling-price-modify/bulk/jobs/[jobId]/canary/dispatch/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/shopling-price-modify/bulk/jobs/[jobId]/canary/result/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/shopling-price-modify/bulk/jobs/[jobId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkInputPreview.tsx", import.meta.url), "utf8"),
  ]);

  for (const rpc of [
    "reserve_shopling_price_bulk_canary",
    "mark_shopling_price_bulk_canary_running",
    "reset_shopling_price_bulk_canary_rejected",
    "block_shopling_price_bulk_canary_uncertain",
    "finish_shopling_price_bulk_canary",
  ]) {
    assert.match(migration, new RegExp(`function public.${rpc}`));
  }
  assert.match(migration, /shopling_price_bulk_chunks_request_id_unique/);
  assert.match(migration, /grant execute[\s\S]*service_role/);
  assert.match(migration, /dispatch_uncertain/);
  assert.match(dispatchRoute, /reserve_shopling_price_bulk_canary[\s\S]*dispatchShoplingPriceBulkCanary/);
  assert.match(dispatchRoute, /일반 청크는 실행되지 않습니다/);
  assert.match(resultRoute, /fetchShoplingPriceModifyActionsResult\(requestId\)/);
  assert.match(resultRoute, /finish_shopling_price_bulk_canary/);
  assert.match(detailRoute, /request_id,actions_url,result_summary,last_error/);
  assert.match(ui, /카나리[\s\S]*실제 실행/);
  assert.match(ui, /일반 청크는 자동 실행되지 않습니다/);
  assert.match(ui, /카나리 결과 확인/);
  assert.match(ui, /chunks\.find\(\(chunk\) => chunk\.chunk_index === 0 && chunk\.chunk_type === "canary"\)/);
  assert.match(ui, /detail\.job\.status === "dispatch_uncertain" && canary\?\.status === "dispatch_uncertain"/);
  assert.doesNotMatch(ui, /detail\.job\.status === "dispatch_uncertain" && detail\.current_active_chunk\?\.chunk_type === "canary"/);
  assert.doesNotMatch(dispatchRoute + resultRoute + ui, /setInterval|cron|scheduler|전체 가격설정 시작|실패 상품만 다시 실행/);
});

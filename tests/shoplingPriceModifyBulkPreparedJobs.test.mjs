import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

async function importTranspiledBulkModules() {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const temporaryDirectory = await mkdtemp(join(testDirectory, ".bulk-prepared-"));
  const modules = [
    ["shoplingPriceModifyBulkInput.ts", "shoplingPriceModifyBulkInput.mjs"],
    ["shoplingPriceModifyBulkJobs.ts", "shoplingPriceModifyBulkJobs.mjs"],
    ["shoplingPriceModifyBulkServer.ts", "shoplingPriceModifyBulkServer.mjs"],
  ];
  try {
    for (const [sourceName, outputName] of modules) {
      const sourceUrl = new URL(`../src/lib/${sourceName}`, import.meta.url);
      const source = (await readFile(sourceUrl, "utf8")).replace(
        '"@/lib/shoplingPriceModifyBulkInput"',
        '"./shoplingPriceModifyBulkInput.mjs"',
      );
      const output = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        fileName: sourceName,
        reportDiagnostics: true,
      });
      const errors = output.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
      assert.deepEqual(errors, [], `TypeScript transpilation failed for ${sourceName}`);
      await writeFile(join(temporaryDirectory, outputName), output.outputText, "utf8");
    }
    const jobs = await import(pathToFileURL(join(temporaryDirectory, "shoplingPriceModifyBulkJobs.mjs")));
    const server = await import(pathToFileURL(join(temporaryDirectory, "shoplingPriceModifyBulkServer.mjs")));
    return { ...jobs, ...server };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const { createShoplingPriceBulkPreparedChunks, validateShoplingPriceBulkCreateInput } = await importTranspiledBulkModules();

const valid = (keys) => ({ input_source: "paste", goods_keys: keys, original_count: keys.length, duplicate_count: 0, invalid_count: 0 });
test("prepared chunk seeds cover boundaries and preserve every key exactly once", () => {
  for (const [count, expected] of [[1,1],[10,1],[11,2],[50,2],[51,2],[60,2],[61,3],[10_000,201]]) {
    const keys = Array.from({length:count},(_,index)=>String(index)); const chunks = createShoplingPriceBulkPreparedChunks(keys);
    assert.equal(chunks.length, expected); assert.deepEqual(chunks.flatMap(chunk=>chunk.goodsKeys),keys);
    assert.equal(new Set(chunks.flatMap(chunk=>chunk.goodsKeys)).size,count); assert.ok(chunks.slice(1).every(chunk=>chunk.goodsKeyCount<=50));
    assert.ok(chunks.every((chunk,index)=>chunk.chunkIndex===index&&chunk.status==="pending"&&chunk.attemptCount===0));
  }
});
test("server validation rejects unsafe requests", () => {
  assert.throws(()=>validateShoplingPriceBulkCreateInput(valid([])),/유효한/);
  assert.throws(()=>validateShoplingPriceBulkCreateInput(valid(Array.from({length:20_001},(_,i)=>String(i)))),/20,000/);
  assert.throws(()=>validateShoplingPriceBulkCreateInput(valid(["1A"])),/숫자/);
  assert.throws(()=>validateShoplingPriceBulkCreateInput(valid(["1","1"])),/중복/);
  assert.throws(()=>validateShoplingPriceBulkCreateInput({...valid(["1"]),input_source:"txt"}),/입력 방식/);
  assert.throws(()=>validateShoplingPriceBulkCreateInput({...valid(["1"]),invalid_count:-1}),/통계/);
  assert.throws(()=>validateShoplingPriceBulkCreateInput({...valid(["1"]),original_count:2}),/통계/);
});
test("migration, API security, and advanced UI prepared-job contracts", async () => {
  const [migration,collection,detail,ui,page,runner] = await Promise.all([
    readFile(new URL("../supabase/migrations/202607260001_shopling_price_bulk_prepared_jobs.sql",import.meta.url),"utf8"),
    readFile(new URL("../src/app/api/shopling-price-modify/bulk/jobs/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/app/api/shopling-price-modify/bulk/jobs/[jobId]/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkInputPreview.tsx",import.meta.url),"utf8"),
    readFile(new URL("../src/app/shopling-price-modify-runner/advanced/page.tsx",import.meta.url),"utf8"),
    readFile(new URL("../src/components/shopling-price-modify-runner/ShoplingPriceModifyRunner.tsx",import.meta.url),"utf8"),
  ]);
  for(const table of ["shopling_price_bulk_jobs","shopling_price_bulk_items","shopling_price_bulk_chunks"]) { assert.match(migration,new RegExp(`create table public.${table}`)); assert.match(migration,new RegExp(`alter table public.${table} enable row level security`)); }
  assert.match(migration,/on delete cascade/); assert.match(migration,/unique \(job_id, chunk_index\)/); assert.match(migration,/security definer set search_path = public/); assert.match(migration,/grant execute[\s\S]*service_role/); assert.match(migration,/'prepared'/); assert.match(migration,/'pending'/);
  assert.match(collection,/createSupabaseServerClient/); assert.match(collection,/data\.user\.id/); assert.match(collection,/status: 401/); assert.doesNotMatch(collection,/body\.owner_id/); assert.doesNotMatch(collection,/github|shopling api|cron/i);
  assert.match(detail,/normalSession\(request\)/);
  assert.match(detail,/eq\("owner_id", auth\.ownerId\)/);
  assert.doesNotMatch(detail,/createSupabaseServerClient|createSupabaseAdminClient|auth\.getUser/);
  assert.match(detail,/if \(jobResult\.error\) return NextResponse\.json\(\{ error: "Bulk 작업 조회에 실패했습니다\." \}, \{ status: 500 \}\)/);
  assert.match(detail,/if \(!jobResult\.data\) return missing\(\)/);
  assert.match(detail,/const missing = \(\) => NextResponse\.json\(\{ error: "작업을 찾을 수 없거나 접근 권한이 없습니다\." \}, \{ status: 404 \}\)/);
  assert.doesNotMatch(detail,/jobResult\.error\s*\|\|\s*!jobResult\.data/);
  assert.match(ui,/Bulk 준비 작업 저장/); assert.match(ui,/준비 작업 저장만으로는 가격을 수정하지 않습니다/); assert.match(ui,/최근 작업/); assert.match(ui,/bulkJobId/); assert.match(ui,/localStorage/);
  for (const label of ["예상 쇼핑몰 가격 수정 행 수", "카나리 크기", "일반 청크 크기", "goods_key 마지막 5개"]) assert.match(ui, new RegExp(label));
  assert.match(ui,/useEffect\(\(\) => \{[\s\S]*window\.setTimeout\(\(\) => \{[\s\S]*void loadJobs\(\)[\s\S]*void loadDetail\(targetId\)/);
  assert.doesNotMatch(ui,/eslint-disable[\s\S]*react-hooks|setInterval|전체 가격설정 시작|실패 상품만 다시 실행|작업 재개/);
  assert.match(page,/<details/); assert.match(page,/50개 이하 직접 실행/); assert.ok(runner.length>0);
});

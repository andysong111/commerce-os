import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createShoplingPriceBulkPreparedChunks } from "../src/lib/shoplingPriceModifyBulkJobs.ts";
import { validateShoplingPriceBulkCreateInput } from "../src/lib/shoplingPriceModifyBulkServer.ts";

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
test("migration, API security, and UI prepared-only contracts", async () => {
  const [migration,collection,detail,ui,page,runner] = await Promise.all([
    readFile(new URL("../supabase/migrations/202607260001_shopling_price_bulk_prepared_jobs.sql",import.meta.url),"utf8"),
    readFile(new URL("../src/app/api/shopling-price-modify/bulk/jobs/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/app/api/shopling-price-modify/bulk/jobs/[jobId]/route.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkInputPreview.tsx",import.meta.url),"utf8"),
    readFile(new URL("../src/app/shopling-price-modify-runner/page.tsx",import.meta.url),"utf8"),
    readFile(new URL("../src/components/shopling-price-modify-runner/ShoplingPriceModifyRunner.tsx",import.meta.url),"utf8"),
  ]);
  for(const table of ["shopling_price_bulk_jobs","shopling_price_bulk_items","shopling_price_bulk_chunks"]) { assert.match(migration,new RegExp(`create table public.${table}`)); assert.match(migration,new RegExp(`alter table public.${table} enable row level security`)); }
  assert.match(migration,/on delete cascade/); assert.match(migration,/unique \(job_id, chunk_index\)/); assert.match(migration,/security definer set search_path = public/); assert.match(migration,/grant execute[\s\S]*service_role/); assert.match(migration,/'prepared'/); assert.match(migration,/'pending'/);
  assert.match(collection,/createSupabaseServerClient/); assert.match(collection,/data\.user\.id/); assert.match(collection,/status: 401/); assert.doesNotMatch(collection,/body\.owner_id/); assert.doesNotMatch(collection,/github|shopling api|cron/i);
  assert.match(detail,/eq\("owner_id", auth\.user\.id\)/); assert.match(ui,/Bulk 준비 작업 저장/); assert.match(ui,/가격은 아직 변경되지 않았습니다/); assert.match(ui,/최근 준비 작업/); assert.match(ui,/bulkJobId/); assert.match(ui,/localStorage/); assert.doesNotMatch(ui,/setInterval|카나리 실행|재시도|일시중지|재개/);
  assert.match(page,/<details/); assert.match(page,/고급: 50개 이하 즉시 실행/); assert.ok(runner.length>0);
});

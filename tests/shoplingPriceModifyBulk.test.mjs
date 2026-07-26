import test from "node:test";
import assert from "node:assert/strict";
import { parseShoplingPriceBulkInput, splitShoplingPriceBulkChunks, failedGoodsKeys, isSuccessfulCanary, bulkProgress } from "../src/lib/shoplingPriceModifyBulk.ts";
import { parseBulkCsv, valuesFromBulkRows } from "../src/lib/shoplingPriceModifyBulkFile.ts";

test("mixed separators, duplicates and invalid values",()=>{const value=parseShoplingPriceBulkInput("121031,121032\t121033\n121031 bad");assert.deepEqual(value.goodsKeys,["121031","121032","121033"]);assert.equal(value.duplicateCount,1);assert.deepEqual(value.invalid,["bad"]);});
test("CSV recognizes normalized header and refuses ambiguous columns",()=>{assert.deepEqual(parseBulkCsv("Goods Key,name\n1,a\n2,b").goodsKeys,["1","2"]);assert.throws(()=>valuesFromBulkRows([["foo","bar"],["1","2"]]));});
test("single-column XLSX row model uses first column",()=>assert.deepEqual(valuesFromBulkRows([["1"],["2"]]),["1","2"]));
test("20,000 limit",()=>assert.throws(()=>parseShoplingPriceBulkInput(Array.from({length:20001},(_,i)=>String(i)).join(","))));
for(const [count,expected] of [[1,1],[10,1],[11,2],[50,2],[51,2],[10000,201]]) test(`${count} items make ${expected} chunks`,()=>{const keys=Array.from({length:count},(_,i)=>String(i+1));const chunks=splitShoplingPriceBulkChunks(keys);assert.equal(chunks.length,expected);assert.equal(new Set(chunks.flatMap(c=>c.goodsKeys)).size,count);assert.ok(chunks.slice(1).every(c=>c.goodsKeys.length<=50));});
test("exact request id and strict canary success",()=>{assert.equal(isSuccessfulCanary({request_id:"a",status:"success",fail_count:0},"a"),true);assert.equal(isSuccessfulCanary({request_id:"other",status:"success",fail_count:0},"a"),false);});
test("partial failure retries only failed items and totals correctly",()=>{const requested=Array.from({length:50},(_,i)=>String(i));assert.deepEqual(failedGoodsKeys({fail_count:3,errors:[{goods_key:"47"},{goods_key:"48"},{goods_key:"49"}]},requested),["47","48","49"]);const items=requested.map((_,i)=>({status:i<47?"succeeded":"retry_waiting"}));assert.deepEqual(bulkProgress(items),{succeeded:47,finalFailed:0,retryWaiting:3,retrySucceeded:0,completed:47,total:50,ratio:.94});});
test("retry successes are counted once",()=>{const result=bulkProgress(Array.from({length:50},(_,i)=>({status:"succeeded",attempt:i>=47?1:0})));assert.equal(result.succeeded,50);assert.equal(result.retrySucceeded,3);assert.equal(result.finalFailed,0);});

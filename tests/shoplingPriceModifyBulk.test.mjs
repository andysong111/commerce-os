import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { parseBulkPaste, parseBulkCsv, parseBulkXlsx, normalizeBulkRows, XLS_REJECTION_MESSAGE } from "../src/lib/shoplingPriceModifyBulkInput.ts";
import { createBulkChunks, extractFailedGoodsKeys, isSuccessfulSummary, plannedChunkCount } from "../src/lib/shoplingPriceModifyBulkJobs.ts";

test("paste supports mixed separators, preserves order, deduplicates and separates invalid", () => {
  const result = parseBulkPaste("121031, 121032\n121031\tbad 121033 -1 1.2 1e3");
  assert.deepEqual(result.goodsKeys, ["121031", "121032", "121033"]); assert.equal(result.duplicateCount, 1); assert.deepEqual(result.invalid, ["bad", "-1", "1.2", "1e3"]);
  assert.deepEqual(parseBulkPaste("").goodsKeys, []);
  assert.throws(() => parseBulkPaste(Array.from({ length: 20_001 }, (_, i) => String(i)).join(",")), /20,000/);
});

test("CSV recognizes normalized and Korean headers, one-column fallback and blocks ambiguous tables", () => {
  assert.deepEqual(parseBulkCsv(new TextEncoder().encode("goods_key,name\n121,ok\n121,dup\nbad,no\n")).goodsKeys, ["121"]);
  assert.deepEqual(parseBulkCsv(new TextEncoder().encode("샵플링 상품번호\n123\n")).goodsKeys, ["123"]);
  assert.deepEqual(normalizeBulkRows([["121"], ["122"]], "csv").goodsKeys, ["121", "122"]);
  assert.throws(() => normalizeBulkRows([["id", "name"], ["121", "a"]], "csv"), /goods_key 열/);
});

test("xlsx reads only first worksheet and handles shared string/numeric cells", () => {
  const files = {
    "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="First" r:id="rId1"/><sheet name="Ignored" r:id="rId2"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
    "xl/sharedStrings.xml": strToU8('<sst><si><t>goods_key</t></si></sst>'),
    "xl/worksheets/sheet1.xml": strToU8('<worksheet><sheetData><row><c t="s"><v>0</v></c></row><row><c><v>121</v></c></row><row><c t="inlineStr"><is><t>1.2</t></is></c></row></sheetData></worksheet>'),
    "xl/worksheets/sheet2.xml": strToU8('<worksheet><sheetData><row><c><v>999</v></c></row></sheetData></worksheet>'),
  };
  const result = parseBulkXlsx(zipSync(files)); assert.deepEqual(result.goodsKeys, ["121"]); assert.deepEqual(result.invalid, ["1.2"]); assert.match(XLS_REJECTION_MESSAGE, /\.xlsx 또는 \.csv/);
});

test("chunk boundaries preserve order without canary duplication", () => {
  for (const count of [1, 10, 11, 50, 51, 10_000]) { const keys = Array.from({ length: count }, (_, i) => String(i + 1)); const chunks = createBulkChunks(keys); assert.equal(chunks.length, plannedChunkCount(count)); assert.deepEqual(chunks.flatMap((c) => c.goods_keys), keys); assert.ok(chunks.slice(1).every((c) => c.goods_keys.length <= 50)); assert.ok(chunks[0].goods_keys.length <= 10); }
  assert.equal(createBulkChunks(Array.from({ length: 10_000 }, (_, i) => String(i))).length, 201);
});

test("summary rules require success/fail_count zero and failed extraction priority", () => {
  assert.equal(isSuccessfulSummary({ status: "success", fail_count: 0 }), true); assert.equal(isSuccessfulSummary({ status: "partial_failure", fail_count: 1 }), false);
  assert.deepEqual(extractFailedGoodsKeys({ affected_goods_keys: ["2"] }, ["1", "2"]), ["2"]);
  assert.deepEqual(extractFailedGoodsKeys({ errors: [{ goods_key: "3" }] }, ["1"]), ["3"]);
  assert.deepEqual(extractFailedGoodsKeys({}, ["1"]), ["1"]);
});

test("UI, migration and cron contracts are present without client secrets", async () => {
  const { readFile } = await import("node:fs/promises");
  const ui = await readFile(new URL("../src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkRunner.tsx", import.meta.url), "utf8");
  for (const text of ["엑셀·CSV 업로드", "직접 붙여넣기", "실행 전 미리보기", "화면을 닫아도 작업은 계속됩니다.", "실패 상품만 다시 실행", "고급: 50개 이하 즉시 실행"]) assert.ok(ui.includes(text));
  for (const secret of ["SUPABASE_SECRET_KEY", "GITHUB_ACTIONS_TOKEN", "CRON_SECRET"]) assert.equal(ui.includes(secret), false);
  const migration = await readFile(new URL("../supabase/migrations/202607260001_shopling_price_bulk.sql", import.meta.url), "utf8"); assert.match(migration, /for update of c skip locked/i); assert.match(migration, /on delete cascade/i); assert.match(migration, /revoke all/i);
  const cron = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8")); assert.deepEqual(cron.crons[0], { path: "/api/cron/shopling-price-bulk", schedule: "* * * * *" });
});

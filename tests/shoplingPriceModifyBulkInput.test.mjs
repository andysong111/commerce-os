import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import ts from "typescript";

async function importTranspiledBulkInput() {
  const sourceName = "shoplingPriceModifyBulkInput.ts";
  const source = (await readFile(new URL(`../src/lib/${sourceName}`, import.meta.url), "utf8")).replace(
    '"fflate"',
    JSON.stringify(import.meta.resolve("fflate")),
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceName,
    reportDiagnostics: true,
  });
  const errors = output.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
  assert.deepEqual(errors, [], `TypeScript transpilation failed for ${sourceName}`);
  return import(`data:text/javascript;base64,${Buffer.from(output.outputText).toString("base64")}`);
}

const { parseShoplingPriceBulkCsvText, parseShoplingPriceBulkFile, parseShoplingPriceBulkPaste, parseShoplingPriceBulkXlsxBytes, plannedShoplingPriceBulkChunkCount } = await importTranspiledBulkInput();

function xlsx(sheet, { shared = "", secondSheet = "" } = {}) {
  const files = {
    "xl/workbook.xml": strToU8(`<workbook><sheets><sheet name="first" sheetId="1" r:id="rId1"/>${secondSheet ? '<sheet name="second" sheetId="2" r:id="rId2"/>' : ""}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>${secondSheet ? '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>' : ""}</Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${sheet}</sheetData></worksheet>`),
  };
  if (shared) files["xl/sharedStrings.xml"] = strToU8(`<sst>${shared}</sst>`);
  if (secondSheet) files["xl/worksheets/sheet2.xml"] = strToU8(`<worksheet><sheetData>${secondSheet}</sheetData></worksheet>`);
  return zipSync(files);
}
const inlineHeader = '<c r="A1" t="inlineStr"><is><t>goods_key</t></is></c>';

test("paste supports every delimiter, mixed input, empty input, invalid separation, deduplication, and order", () => {
  assert.deepEqual(parseShoplingPriceBulkPaste("121031,121032 121033\t121034\n121035").goodsKeys, ["121031", "121032", "121033", "121034", "121035"]);
  assert.deepEqual(parseShoplingPriceBulkPaste("").goodsKeys, []);
  const parsed = parseShoplingPriceBulkPaste("2 1 2 ABC 121A -121 1.2 1e5");
  assert.deepEqual(parsed.goodsKeys, ["2", "1"]); assert.equal(parsed.duplicateCount, 1);
  assert.deepEqual(parsed.invalid, ["ABC", "121A", "-121", "1.2", "1e5"]);
});
test("paste permits 20,000 unique keys and rejects 20,001", () => {
  assert.equal(parseShoplingPriceBulkPaste(Array.from({ length: 20_000 }, (_, i) => String(i)).join(" ")).validCount, 20_000);
  assert.throws(() => parseShoplingPriceBulkPaste(Array.from({ length: 20_001 }, (_, i) => String(i)).join(" ")), /20,000/);
});

test("CSV accepts one column, BOM, CRLF/LF, blank lines, duplicates, invalid values, and header-only", () => {
  const parsed = parseShoplingPriceBulkCsvText("\uFEFF goods_key \r\n121\r\n\r\n122\n121\nABC\n");
  assert.deepEqual(parsed.goodsKeys, ["121", "122"]); assert.equal(parsed.duplicateCount, 1); assert.deepEqual(parsed.invalid, ["ABC"]);
  assert.equal(parseShoplingPriceBulkCsvText("goods_key\n").validCount, 0);
});
test("CSV handles quoted fields but rejects every multi-column row and a wrong header", () => {
  assert.deepEqual(parseShoplingPriceBulkCsvText('"goods_key"\n"121"').goodsKeys, ["121"]);
  assert.throws(() => parseShoplingPriceBulkCsvText("goods_key,price\n121,9900"), /1열/);
  assert.throws(() => parseShoplingPriceBulkCsvText("goods_key\n121,"), /1열/);
  assert.throws(() => parseShoplingPriceBulkCsvText("id\n121"), /goods_key 헤더/);
});
test("file validation rejects oversized files, .xls, and unsupported extensions", async () => {
  const fake = (name, size) => ({ name, size, arrayBuffer: async () => new ArrayBuffer(0) });
  await assert.rejects(() => parseShoplingPriceBulkFile(fake("large.csv", 5 * 1024 * 1024 + 1)), /5MB/);
  await assert.rejects(() => parseShoplingPriceBulkFile(fake("old.xls", 1)), /구형 \.xls/);
  await assert.rejects(() => parseShoplingPriceBulkFile(fake("data.txt", 1)), /\.xlsx 또는 \.csv/);
});

test("XLSX reads numeric, inline, shared-string, sparse A cells by address and deduplicates", () => {
  const bytes = xlsx('<c r="A5" t="s"><v>1</v></c><c r="A2"><v>121031</v></c><c r="A1" t="s"><v>0</v></c><c r="A7" t="inlineStr"><is><t>ABC</t></is></c><c r="A6"><v>121031</v></c>', { shared: "<si><t>goods_key</t></si><si><t>121032</t></si>" });
  const parsed = parseShoplingPriceBulkXlsxBytes(bytes);
  assert.deepEqual(parsed.goodsKeys, ["121031", "121032"]); assert.equal(parsed.duplicateCount, 1); assert.deepEqual(parsed.invalid, ["ABC"]);
});
test("XLSX ignores the second sheet", () => {
  const parsed = parseShoplingPriceBulkXlsxBytes(xlsx(`${inlineHeader}<c r="A2"><v>1</v></c>`, { secondSheet: '<c r="B1"><v>999</v></c>' }));
  assert.deepEqual(parsed.goodsKeys, ["1"]);
});
test("XLSX rejects bad header, non-empty B+ cells, formulas, missing sheet, and invalid ZIP", () => {
  assert.throws(() => parseShoplingPriceBulkXlsxBytes(xlsx('<c r="A1" t="inlineStr"><is><t>id</t></is></c>')), /A1/);
  assert.throws(() => parseShoplingPriceBulkXlsxBytes(xlsx(`${inlineHeader}<c r="B2"><v>9</v></c>`)), /A열 하나/);
  assert.throws(() => parseShoplingPriceBulkXlsxBytes(xlsx(`${inlineHeader}<c r="A2"><f>1+1</f><v>2</v></c>`)), /수식/);
  assert.throws(() => parseShoplingPriceBulkXlsxBytes(zipSync({ "xl/workbook.xml": strToU8("<workbook/>") })), /첫 번째 시트/);
  assert.throws(() => parseShoplingPriceBulkXlsxBytes(strToU8("not zip")), /읽을 수 없습니다/);
});

test("planned chunk counts follow a 10-item canary and 50-item regular chunks", () => {
  for (const [count, expected] of [[0,0],[1,1],[10,1],[11,2],[50,2],[51,2],[60,2],[61,3],[10_000,201]]) assert.equal(plannedShoplingPriceBulkChunkCount(count), expected);
});

test("UI contract keeps input validation and the existing runner", async () => {
  const [page, component, library] = await Promise.all([
    readFile(new URL("../src/app/shopling-price-modify-runner/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkInputPreview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/shoplingPriceModifyBulkInput.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<ShoplingPriceModifyRunner \/>/); assert.match(page, /ShoplingPriceModifyBulkInputPreview/); assert.match(page, /<details/);
  for (const phrase of ["고정 양식", "실제 가격을 수정하지 않습니다", "파일 업로드", "직접 붙여넣기", "실행 전 미리보기"]) assert.match(component, new RegExp(phrase));
  assert.doesNotMatch(component, /setSelection\(null\)/);
  assert.match(component, /const onPaste[\s\S]*?catch \(caught\) \{ setError/);
  assert.match(component, /const onFile[\s\S]*?catch \(caught\) \{ setError/);
  assert.doesNotMatch(library, /fetch\s*\(/); assert.doesNotMatch(library, /supabase/i); assert.doesNotMatch(component + library, /https?:\/\//);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { zipSync, strToU8 } from "fflate";

const source = await readFile(new URL("../src/lib/shoplingPriceModifyBulkInput.ts", import.meta.url), "utf8");
const transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace('from "fflate"', `from "${import.meta.resolve("fflate")}"`);
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`;
const { parseShoplingPriceBulkPaste, parseShoplingPriceBulkCsvText, parseShoplingPriceBulkXlsxBytes, parseShoplingPriceBulkFile, plannedShoplingPriceBulkChunkCount } = await import(moduleUrl);

function xlsx(cells, secondSheet = "") {
  const sheets = secondSheet ? '<sheet name="Second" sheetId="2" r:id="rId2"/>' : "";
  const rel2 = secondSheet ? '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/>' : "";
  const files = {
    "xl/workbook.xml": strToU8(`<workbook xmlns:r="x"><sheets><sheet name="First" sheetId="1" r:id="rId1"/>${sheets}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>${rel2}</Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData><row>${cells}</row></sheetData></worksheet>`),
    "xl/sharedStrings.xml": strToU8("<sst><si><t>goods_key</t></si><si><t>121033</t></si></sst>"),
  };
  if (secondSheet) files["xl/worksheets/sheet2.xml"] = strToU8(`<worksheet><sheetData>${secondSheet}</sheetData></worksheet>`);
  return zipSync(files);
}

test("붙여넣기는 모든 구분자, 순서, 중복과 invalid를 처리한다", () => {
  const result = parseShoplingPriceBulkPaste("121031,121032 121033\t121031\nABC -121 1.2 1e5 121A");
  assert.deepEqual(result.goodsKeys, ["121031", "121032", "121033"]);
  assert.deepEqual(result.invalid, ["ABC", "-121", "1.2", "1e5", "121A"]);
  assert.equal(result.duplicateCount, 1); assert.equal(result.originalCount, 9);
  assert.equal(parseShoplingPriceBulkPaste("").validCount, 0);
});

test("붙여넣기는 20,000개를 허용하고 20,001개를 거부한다", () => {
  assert.equal(parseShoplingPriceBulkPaste(Array.from({ length: 20_000 }, (_, i) => String(i)).join(",")).validCount, 20_000);
  assert.throws(() => parseShoplingPriceBulkPaste(Array.from({ length: 20_001 }, (_, i) => String(i)).join(" ")), /20,000/);
});

test("CSV는 BOM, CRLF/LF, 빈 행, 따옴표, 중복과 invalid를 처리한다", () => {
  const result = parseShoplingPriceBulkCsvText('\uFEFF"goods_key"\r\n121031\r\n\r\n121031\nABC\n');
  assert.deepEqual(result.goodsKeys, ["121031"]); assert.deepEqual(result.invalid, ["ABC"]); assert.equal(result.duplicateCount, 1);
  assert.equal(parseShoplingPriceBulkCsvText("goods_key\n").validCount, 0);
});

test("CSV는 잘못된 헤더와 2열을 거부한다", () => {
  assert.throws(() => parseShoplingPriceBulkCsvText("id\n1"), /첫 번째 행/);
  assert.throws(() => parseShoplingPriceBulkCsvText("goods_key,price\n121031,9900"), /1열/);
  assert.deepEqual(parseShoplingPriceBulkCsvText('goods_key\n"12,13"').invalid, ["12,13"]);
});

test("파일 확장자 및 5MB 제한을 검사한다", async () => {
  await assert.rejects(() => parseShoplingPriceBulkFile({ name: "old.xls", size: 1, arrayBuffer: async () => new ArrayBuffer() }), /구형 .xls/);
  await assert.rejects(() => parseShoplingPriceBulkFile({ name: "large.csv", size: 5 * 1024 * 1024 + 1, arrayBuffer: async () => new ArrayBuffer() }), /5MB/);
});

test("XLSX 첫 시트에서 shared, numeric, inline string과 sparse A열을 주소 순으로 읽는다", () => {
  const bytes = xlsx('<c r="A5" t="inlineStr"><is><t>121032</t></is></c><c r="A1" t="s"><v>0</v></c><c r="A3" t="s"><v>1</v></c><c r="A2"><v>121031</v></c><c r="A6"><v>121031</v></c>', '<row><c r="A1"><v>ignored</v></c></row>');
  const result = parseShoplingPriceBulkXlsxBytes(bytes);
  assert.deepEqual(result.goodsKeys, ["121031", "121033", "121032"]); assert.equal(result.duplicateCount, 1);
});

test("XLSX는 invalid를 분리하고 헤더, 다른 열, 수식, ZIP 오류를 거부한다", () => {
  assert.deepEqual(parseShoplingPriceBulkXlsxBytes(xlsx('<c r="A1" t="inlineStr"><is><t>goods_key</t></is></c><c r="A2" t="inlineStr"><is><t>1e5</t></is></c>')).invalid, ["1e5"]);
  assert.throws(() => parseShoplingPriceBulkXlsxBytes(xlsx('<c r="A1"><v>wrong</v></c>')), /A1/);
  assert.throws(() => parseShoplingPriceBulkXlsxBytes(xlsx('<c r="A1" t="s"><v>0</v></c><c r="B2"><v>9900</v></c>')), /A열 하나/);
  assert.throws(() => parseShoplingPriceBulkXlsxBytes(xlsx('<c r="A1" t="s"><v>0</v></c><c r="A2"><f>1+1</f><v>2</v></c>')), /수식/);
  assert.throws(() => parseShoplingPriceBulkXlsxBytes(new Uint8Array([1, 2, 3])), /읽을 수 없습니다/);
  assert.throws(() => parseShoplingPriceBulkXlsxBytes(zipSync({ "xl/workbook.xml": strToU8("<workbook/>") })), /첫 번째 시트/);
});

test("예상 청크 수를 카나리 10개와 일반 50개 기준으로 계산한다", () => {
  for (const [count, expected] of [[0, 0], [1, 1], [10, 1], [11, 2], [50, 2], [51, 2], [60, 2], [61, 3], [10_000, 201]]) assert.equal(plannedShoplingPriceBulkChunkCount(count), expected);
});

test("UI 계약: 기존 실행기와 로컬 전용 Bulk 안내/입력/미리보기를 유지한다", async () => {
  const page = await readFile(new URL("../src/app/shopling-price-modify-runner/page.tsx", import.meta.url), "utf8");
  const ui = await readFile(new URL("../src/components/shopling-price-modify-runner/ShoplingPriceModifyBulkInputPreview.tsx", import.meta.url), "utf8");
  assert.match(page, /ShoplingPriceModifyRunner/); assert.match(page, /ShoplingPriceModifyBulkInputPreview/);
  for (const text of ["고정 양식", "실제 가격을 수정하지 않습니다", "파일 업로드", "직접 붙여넣기", "실행 전 미리보기"]) assert.match(ui, new RegExp(text));
  for (const forbidden of ["fetch(", "/api/shopling-price-modify/bulk", "supabase", "cdn.sheetjs.com", "https://"]) assert.doesNotMatch(ui.toLowerCase(), new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

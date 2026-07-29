import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import ts from "typescript";

async function importAdjustmentModule() {
  const sourceName = "shoplingPriceAdjustmentInput.ts";
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

const adjustment = await importAdjustmentModule();

function xlsx(sheet, shared = "") {
  const files = {
    "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="first" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${sheet}</sheetData></worksheet>`),
  };
  if (shared) files["xl/sharedStrings.xml"] = strToU8(`<sst>${shared}</sst>`);
  return zipSync(files);
}

const inlineHeaders = '<c r="A1" t="inlineStr"><is><t>goods_key</t></is></c><c r="B1" t="inlineStr"><is><t>adjustment_rate</t></is></c>';

test("rate parser converts decimal percent strings to exact integer basis points", () => {
  assert.equal(adjustment.parseShoplingPriceAdjustmentRateBps("10"), 1000);
  assert.equal(adjustment.parseShoplingPriceAdjustmentRateBps("+7.25%"), 725);
  assert.equal(adjustment.parseShoplingPriceAdjustmentRateBps("-5"), -500);
  assert.equal(adjustment.parseShoplingPriceAdjustmentRateBps("0"), 0);
  assert.throws(() => adjustment.parseShoplingPriceAdjustmentRateBps("1.234"), /처럼 입력/);
  assert.throws(() => adjustment.parseShoplingPriceAdjustmentRateBps("-100"), /-99.99/);
  assert.throws(() => adjustment.parseShoplingPriceAdjustmentRateBps("1000.01"), /1,000/);
});

test("paste accepts whitespace, tab and comma rows, preserves order and removes identical duplicates", () => {
  const parsed = adjustment.parseShoplingPriceAdjustmentPaste("goods_key adjustment_rate\n119836 10\n119837\t-5\n119838,7.25%\n119836,+10%");
  assert.deepEqual(parsed.rows.map((row) => [row.goodsKey, row.adjustmentBps]), [
    ["119836", 1000],
    ["119837", -500],
    ["119838", 725],
  ]);
  assert.equal(parsed.duplicateCount, 1);
  assert.equal(parsed.invalidCount, 0);
});

test("conflicting rates exclude the goods_key instead of silently choosing one", () => {
  const parsed = adjustment.parseShoplingPriceAdjustmentPaste("119836 10\n119837 5\n119836 -5");
  assert.deepEqual(parsed.goodsKeys, ["119837"]);
  assert.equal(parsed.conflictCount, 1);
  assert.equal(parsed.invalidCount, 1);
  assert.match(parsed.invalid[0], /서로 다른 조정률/);
});

test("invalid goods keys, missing values and unsafe rate formats are separated", () => {
  const parsed = adjustment.parseShoplingPriceAdjustmentPaste("ABC 10\n119836\n119837 1e2\n119838 -100\n119839 10 extra");
  assert.equal(parsed.validCount, 0);
  assert.equal(parsed.invalidCount, 5);
});

test("20,000 unique rows are accepted and 20,001 are rejected", () => {
  const input = Array.from({ length: 20_000 }, (_, index) => `${900000 + index} 10`).join("\n");
  assert.equal(adjustment.parseShoplingPriceAdjustmentPaste(input).validCount, 20_000);
  assert.throws(
    () => adjustment.parseShoplingPriceAdjustmentPaste(`${input}\n999999999 10`),
    /20,000/,
  );
});

test("CSV requires the exact two-column contract and supports quoted rates", () => {
  const parsed = adjustment.parseShoplingPriceAdjustmentCsvText('\uFEFFgoods_key,adjustment_rate\r\n119836,"10%"\r\n119837,-5');
  assert.deepEqual(parsed.rows.map((row) => row.adjustmentBps), [1000, -500]);
  assert.throws(() => adjustment.parseShoplingPriceAdjustmentCsvText("goods_key,rate\n1,10"), /첫 행/);
  assert.throws(() => adjustment.parseShoplingPriceAdjustmentCsvText("goods_key,adjustment_rate,extra\n1,10,x"), /첫 행/);
  assert.throws(() => adjustment.parseShoplingPriceAdjustmentCsvText("goods_key,adjustment_rate\n1,10,x"), /두 열만/);
});

test("XLSX reads A/B cells by address and ignores sparse blank rows", () => {
  const parsed = adjustment.parseShoplingPriceAdjustmentXlsxBytes(xlsx(
    `${inlineHeaders}<c r="A5"><v>119837</v></c><c r="B5" t="inlineStr"><is><t>-5</t></is></c><c r="A2"><v>119836</v></c><c r="B2"><v>10</v></c>`,
  ));
  assert.deepEqual(parsed.rows.map((row) => [row.goodsKey, row.adjustmentBps]), [["119836", 1000], ["119837", -500]]);
});

test("XLSX supports shared strings and rejects C+ data, formulas and wrong headers", () => {
  const shared = "<si><t>goods_key</t></si><si><t>adjustment_rate</t></si><si><t>7.25%</t></si>";
  const parsed = adjustment.parseShoplingPriceAdjustmentXlsxBytes(xlsx(
    '<c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="A2"><v>119836</v></c><c r="B2" t="s"><v>2</v></c>',
    shared,
  ));
  assert.equal(parsed.rows[0].adjustmentBps, 725);
  assert.throws(() => adjustment.parseShoplingPriceAdjustmentXlsxBytes(xlsx(`${inlineHeaders}<c r="C2"><v>1</v></c>`)), /A열 goods_key와 B열/);
  assert.throws(() => adjustment.parseShoplingPriceAdjustmentXlsxBytes(xlsx(`${inlineHeaders}<c r="A2"><v>1</v></c><c r="B2"><f>5+5</f><v>10</v></c>`)), /수식/);
  assert.throws(() => adjustment.parseShoplingPriceAdjustmentXlsxBytes(xlsx('<c r="A1"><v>wrong</v></c>')), /A1은 goods_key/);
});

test("price calculations use exact integer math and 10-won ceiling", () => {
  assert.equal(adjustment.calculateShoplingAdjustedSellPrice(10_000, 1000), 11_000);
  assert.equal(adjustment.calculateShoplingAdjustedSellPrice(10_003, 1000), 11_010);
  assert.equal(adjustment.calculateShoplingAdjustedSellPrice(10_003, -1000), 9_010);
  assert.equal(adjustment.calculateShoplingAdjustedSellPrice(9_900, 725), 10_620);
  assert.equal(adjustment.calculateShoplingAdjustedSellPrice(1_003, 0), 1_003);
  assert.deepEqual(adjustment.calculateShoplingAdjustedPriceColumns(10_003, 1000), {
    sellPrice: 11_010,
    consumerPrice: 16_515,
    purchasePrice: 5_505,
  });
  assert.equal(adjustment.calculateShoplingAdjustedOptionAmount(1_003, 1000), 1_110);
  assert.equal(adjustment.calculateShoplingAdjustedOptionAmount(0, 1000), 0);
  assert.throws(() => adjustment.calculateShoplingAdjustedOptionAmount(-100, 1000), /0 이상의 정수/);
});

test("chunk plan keeps the completed 10-item canary and 50-item serial pattern", () => {
  for (const [count, expected] of [[0, 0], [1, 1], [10, 1], [11, 2], [60, 2], [61, 3], [20_000, 401]]) {
    assert.equal(adjustment.plannedShoplingPriceAdjustmentChunkCount(count), expected);
  }
});

test("new route and UI are read-only and registered on the dashboard and sidebar", async () => {
  const [page, component, library, registry, dashboard, sidebar] = await Promise.all([
    readFile(new URL("../src/app/shopling-price-adjustment-runner/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/shopling-price-adjustment/ShoplingPriceAdjustmentInputPreview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/shoplingPriceAdjustmentInput.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/extendedModuleRegistry.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/Sidebar.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /샵플링 판매가 인상·인하 실행기/);
  for (const phrase of ["최대 20,000개", "가격 쓰기 차단", "goods_key", "adjustment_rate", "10원 단위 올림"]) {
    assert.match(component, new RegExp(phrase));
  }
  assert.match(registry, /shopling-price-adjustment-runner/);
  assert.match(registry, /\/shopling-price-adjustment-runner/);
  assert.match(dashboard, /extendedModuleRegistry/);
  assert.match(sidebar, /extendedModuleRegistry/);
  assert.match(sidebar, /shopling-price-adjustment-runner/);
  assert.doesNotMatch(component + library, /fetch\s*\(/);
  assert.doesNotMatch(component + library, /supabase/i);
  assert.doesNotMatch(component + library, /api\.shopling/i);
  assert.doesNotMatch(component + library, /github\.com/i);
});

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function importEditorModule() {
  const sourceName = "shoplingPriceAdjustmentIndividualEditor.ts";
  const source = await readFile(new URL(`../src/lib/${sourceName}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: sourceName,
    reportDiagnostics: true,
  });
  const errors = output.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
  assert.deepEqual(errors, [], `TypeScript transpilation failed for ${sourceName}`);
  return import(`data:text/javascript;base64,${Buffer.from(output.outputText).toString("base64")}`);
}

const editor = await importEditorModule();

test("individual draft accepts goods_key-only rows and optional existing rates", () => {
  const parsed = editor.parseShoplingIndividualDraft("goods_key\n102759\n102758 10\n102755,-5\n102759");
  assert.deepEqual(parsed.rows, [
    { goodsKey: "102759", rateText: "" },
    { goodsKey: "102758", rateText: "10" },
    { goodsKey: "102755", rateText: "-5" },
  ]);
  assert.equal(parsed.duplicateCount, 1);
  assert.deepEqual(parsed.invalid, []);
});

test("bulk rate applies only to checked rows or to all rows", () => {
  const rows = [
    { goodsKey: "1", rateText: "" },
    { goodsKey: "2", rateText: "-5" },
    { goodsKey: "3", rateText: "" },
  ];
  assert.deepEqual(editor.applyShoplingIndividualBulkRate(rows, new Set(["1", "3"]), "10", false), [
    { goodsKey: "1", rateText: "10" },
    { goodsKey: "2", rateText: "-5" },
    { goodsKey: "3", rateText: "10" },
  ]);
  assert.deepEqual(editor.applyShoplingIndividualBulkRate(rows, new Set(), "7.25", true).map((row) => row.rateText), ["7.25", "7.25", "7.25"]);
});

test("serialization produces the existing two-column individual input contract", () => {
  assert.equal(editor.serializeShoplingIndividualDraft([
    { goodsKey: "102759", rateText: "10" },
    { goodsKey: "102758", rateText: "-5" },
  ]), "102759\t10\n102758\t-5");
});

test("individual editor UI exposes checkbox selection, selected/all bulk apply, per-row rates and transfer", async () => {
  const [page, component] = await Promise.all([
    readFile(new URL("../src/app/shopling-price-adjustment-runner/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/shopling-price-adjustment/ShoplingPriceAdjustmentIndividualBulkEditor.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /ShoplingPriceAdjustmentIndividualBulkEditor/);
  for (const phrase of ["개별 설정 빠른 편집", "체크 상품에 반영", "전체에 반영", "전체 선택", "전체 해제", "개별 설정 입력칸에 반영"]) {
    assert.match(component, new RegExp(phrase));
  }
  assert.match(component, /type="checkbox"/);
  assert.match(component, /parseShoplingPriceAdjustmentRateBps/);
  assert.match(component, /textarea\[aria-label=/);
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadEngine() {
  const directory = await mkdtemp(join(dirname(new URL(import.meta.url).pathname), ".sales-backfill-"));
  let source = await readFile(
    new URL("../src/lib/productMasterShoplingSalesBackfillEngine.ts", import.meta.url),
    "utf8",
  );
  source = source
    .replace(
      'from "@/lib/shopling/shoplingNormalize"',
      `from ${JSON.stringify(new URL("../src/lib/shopling/shoplingNormalize.ts", import.meta.url).href)}`,
    )
    .replace(
      /import type \{ ShoplingDateRange \} from "@\/lib\/shopling\/shoplingReadClient";\n/,
      "",
    )
    .replace(
      /import type \{ ProductPlanningSnapshot \} from "@\/lib\/shopling\/shoplingLiveAggregation";\n/,
      "",
    );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const file = join(directory, "engine.mjs");
  await writeFile(file, output);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const {
  aggregateProductMasterShoplingSalesChunk,
  combineProductMasterShoplingSalesChunks,
} = await loadEngine();

function planning(overrides = {}) {
  return {
    generatedAt: "2026-08-07T00:00:00.000Z",
    products: [
      {
        skuId: "sku-1",
        barcode: "BAA1-1",
        productName: "상품",
        optionName: "단품",
        skuActive: true,
        listings: [
          { goodsKey: "1001", optionId: "O1", unitsPerOrder: 2, active: true },
        ],
      },
    ],
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    ord_no: "ORD-1",
    mall_ord_seq: "1",
    mall_ord_dt: "20260806120000",
    ord_status: "배송완료",
    opt_id: "O1",
    prod_id: "1001",
    mall_ord_cnt: "3",
    mall_unit_price: "1000",
    ...overrides,
  };
}

test("monthly backfill converts order quantity through unitsPerOrder", () => {
  const result = aggregateProductMasterShoplingSalesChunk(
    [order()],
    planning(),
    { start: "2026-08-01", end: "2026-08-07" },
  );
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.monthlyRows[0].quantity, 6);
  assert.equal(result.monthlyRows[0].revenue, 3000);
  assert.equal(result.monthlyRows[0].id, "shopling-sales-v1:BAA1-1:2026-08");
});

test("cancelled and refunded orders never enter canonical sales", () => {
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ ord_status: "취소완료" }), order({ ord_no: "ORD-2", ord_status: "refund" })],
    planning(),
    { start: "2026-08-01", end: "2026-08-07" },
  );
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.ignoredRows, 2);
  assert.equal(result.monthlyRows.length, 0);
});

test("historical consignment orders outside managed barcode catalog are ignored instead of blocking", () => {
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "OLD-CONSIGNMENT", prod_id: "900000", mall_prod_key: "900000" })],
    planning(),
    { start: "2026-08-01", end: "2026-08-07" },
  );
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.ignoredRows, 1);
  assert.equal(result.monthlyRows.length, 0);
});

test("managed catalog identities stay in scope even when an exact mapping is ambiguous", () => {
  const ambiguous = planning({
    products: [
      {
        skuId: "sku-1",
        barcode: "BAA1-1",
        productName: "상품",
        optionName: "단품",
        skuActive: true,
        listings: [
          { goodsKey: "1001", optionId: "O1", unitsPerOrder: 1, active: true },
          { goodsKey: "1001", optionId: "O2", unitsPerOrder: 2, active: true },
        ],
      },
    ],
  });
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "OLD", prod_id: "1001" })],
    ambiguous,
    { start: "2026-08-01", end: "2026-08-07" },
  );
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.unmappedRows, 1);
  assert.equal(result.ignoredRows, 0);
});

test("managed partner code can recover an order when historical option identity is absent", () => {
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "OLD", prod_id: "OLD", ptn_goods_cd: "BAA1-1" })],
    planning(),
    { start: "2026-08-01", end: "2026-08-07" },
  );
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.monthlyRows[0].quantity, 6);
});

test("ambiguous barcode pack ratios are never guessed from the barcode alone", () => {
  const ambiguous = planning({
    products: [
      {
        skuId: "sku-1",
        barcode: "BAA1-1",
        productName: "상품",
        optionName: "단품",
        skuActive: true,
        listings: [
          { goodsKey: "1001", optionId: "O1", unitsPerOrder: 1, active: true },
          { goodsKey: "1002", optionId: "O2", unitsPerOrder: 2, active: true },
        ],
      },
    ],
  });
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "OLD", prod_id: "OLD", ptn_goods_cd: "BAA1-1" })],
    ambiguous,
    { start: "2026-08-01", end: "2026-08-07" },
  );
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.unmappedRows, 1);
});

test("chunk combination merges split ranges into one deterministic month row", () => {
  const first = aggregateProductMasterShoplingSalesChunk(
    [order({ mall_ord_dt: "20260802120000" })],
    planning(),
    { start: "2026-08-01", end: "2026-08-03" },
  );
  const second = aggregateProductMasterShoplingSalesChunk(
    [order({ ord_no: "ORD-2", mall_ord_dt: "20260805120000", mall_ord_cnt: "1" })],
    planning(),
    { start: "2026-08-04", end: "2026-08-07" },
  );
  const result = combineProductMasterShoplingSalesChunks([first, second]);
  assert.equal(result.monthlyRowCount, 1);
  assert.equal(result.rows[0].quantity, 8);
  assert.equal(result.rows[0].revenue, 4000);
});

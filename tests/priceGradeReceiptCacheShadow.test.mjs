import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadModule() {
  const testDirectory = dirname(new URL(import.meta.url).pathname);
  const directory = await mkdtemp(join(testDirectory, ".price-grade-cache-"));
  const receiptStub = join(directory, "receipt-cache.mjs");
  const comparisonStub = join(directory, "comparison.mjs");
  const supabaseStub = join(directory, "supabase.mjs");
  await Promise.all([
    writeFile(
      receiptStub,
      "export async function readPriceAdjustmentReceiptCache(){ return null; }\n",
    ),
    writeFile(
      comparisonStub,
      "export function comparePriceGradeInputs(){ throw new Error('not used'); }\nexport async function loadPriceGradeInputSnapshot(){ throw new Error('not used'); }\n",
    ),
    writeFile(
      supabaseStub,
      "export function createSupabaseAdminHeaders(){ return {}; }\n",
    ),
  ]);
  let source = await readFile(
    "src/lib/priceGradeReceiptCacheShadow.ts",
    "utf8",
  );
  source = source
    .replace(
      'from "@/lib/priceAdjustmentReceiptCache"',
      `from ${JSON.stringify(pathToFileURL(receiptStub).href)}`,
    )
    .replace(
      'from "@/lib/priceGradeShadowComparison"',
      `from ${JSON.stringify(pathToFileURL(comparisonStub).href)}`,
    )
    .replace(
      'from "@/lib/supabase/admin"',
      `from ${JSON.stringify(pathToFileURL(supabaseStub).href)}`,
    );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "priceGradeReceiptCacheShadow.ts",
  }).outputText;
  const file = join(directory, "module.mjs");
  await writeFile(file, output);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const { augmentPriceGradeSnapshotWithReceiptCache } = await loadModule();

function input(barcode, receipts = []) {
  return {
    skuId: barcode,
    barcode,
    productName: barcode,
    currentPrice: 1000,
    currentGrade: 0,
    monthlyUnits: [10, 10, 10],
    receipts,
    existingLifecycle: null,
  };
}

function snapshot(inputs) {
  return {
    ok: true,
    generatedAt: "2026-08-05T00:00:00.000Z",
    contentFingerprint: `sha256:${"a".repeat(64)}`,
    inputCount: inputs.length,
    inputs,
  };
}

function receipt(id, barcode, receivedAt, unitCostKrw) {
  return {
    id,
    receiptId: id,
    batchId: 1,
    orderItemId: 1,
    barcode,
    modelNumber: "AAA001",
    optionName: "단품",
    quantity: 10,
    unitCostKrw,
    receivedAt,
  };
}

function cache(complete = true) {
  return {
    snapshotId: "receipt-cache-1",
    generatedAt: "2026-08-04T00:00:00.000Z",
    complete,
    barcodeCount: 1,
    receiptCount: 4,
    updatedAt: "2026-08-04T00:00:00.000Z",
    receiptsByBarcode: {
      "BAA1-1": [
        receipt("4", "BAA1-1", "2026-08-04T00:00:00.000Z", 340),
        receipt("3", "BAA1-1", "2026-07-04T00:00:00.000Z", 330),
        receipt("2", "BAA1-1", "2026-06-04T00:00:00.000Z", 320),
        receipt("1", "BAA1-1", "2026-05-04T00:00:00.000Z", 310),
      ],
    },
  };
}

test("Product Master receipt rows always take precedence over the fallback cache", () => {
  const primary = [
    {
      receivedAt: "2026-08-01T00:00:00.000Z",
      unitCostKrw: 500,
      quantity: 20,
    },
  ];
  const result = augmentPriceGradeSnapshotWithReceiptCache(
    snapshot([input("BAA1-1", primary)]),
    cache(),
  );
  assert.deepEqual(result.snapshot.inputs[0].receipts, primary);
  assert.equal(result.receiptEvidence.productMasterReceiptProductCount, 1);
  assert.equal(result.receiptEvidence.fallbackProductCount, 0);
});

test("complete cache fills only missing receipts and keeps the newest three rows", () => {
  const result = augmentPriceGradeSnapshotWithReceiptCache(
    snapshot([input("baa1-1")]),
    cache(),
  );
  assert.deepEqual(
    result.snapshot.inputs[0].receipts.map((row) => row.unitCostKrw),
    [340, 330, 320],
  );
  assert.equal(result.receiptEvidence.cacheComplete, true);
  assert.equal(result.receiptEvidence.fallbackProductCount, 1);
  assert.equal(result.receiptEvidence.fallbackReceiptRowCount, 3);
  assert.equal(result.receiptEvidence.remainingWithoutReceiptCount, 0);
});

test("partial cache fails closed instead of treating incomplete evidence as exact", () => {
  const result = augmentPriceGradeSnapshotWithReceiptCache(
    snapshot([input("BAA1-1")]),
    cache(false),
  );
  assert.deepEqual(result.snapshot.inputs[0].receipts, []);
  assert.equal(result.receiptEvidence.cacheAvailable, true);
  assert.equal(result.receiptEvidence.cacheComplete, false);
  assert.equal(result.receiptEvidence.fallbackProductCount, 0);
  assert.equal(result.receiptEvidence.remainingWithoutReceiptCount, 1);
});

test("augmented content fingerprint changes with the actual receipt evidence", () => {
  const first = augmentPriceGradeSnapshotWithReceiptCache(
    snapshot([input("BAA1-1")]),
    cache(),
  );
  const changed = cache();
  changed.receiptsByBarcode["BAA1-1"][0].unitCostKrw = 999;
  const second = augmentPriceGradeSnapshotWithReceiptCache(
    snapshot([input("BAA1-1")]),
    changed,
  );
  assert.match(first.snapshot.contentFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(
    first.snapshot.contentFingerprint,
    second.snapshot.contentFingerprint,
  );
});

test("shadow route uses receipt-cache comparison and remains separate from price execution", async () => {
  const [route, service] = await Promise.all([
    readFile(
      "src/app/api/price-adjustment-engine/shadow-compare/route.ts",
      "utf8",
    ),
    readFile("src/lib/priceGradeReceiptCacheShadow.ts", "utf8"),
  ]);
  assert.match(route, /runPriceGradeShadowComparisonWithReceiptCache/);
  assert.match(service, /readPriceAdjustmentReceiptCache/);
  assert.match(service, /cache\?\.complete/);
  assert.match(service, /remainingWithoutReceiptCount/);
  assert.match(service, /writesEnabled/);
  assert.doesNotMatch(route + service, /shopling-price-adjustment-runner/);
  assert.doesNotMatch(service, /1688|price.*update|inventory.*update/i);
});

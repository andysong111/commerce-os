import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadEngine() {
  const testDirectory = dirname(new URL(import.meta.url).pathname);
  const directory = await mkdtemp(join(testDirectory, ".product-master-shopling-"));
  const sourcePath = new URL(
    "../src/lib/productMasterShoplingDiagnosticEngine.ts",
    import.meta.url,
  );
  let source = await readFile(sourcePath, "utf8");
  source = source.replace(
    'from "@/lib/shopling/shoplingNormalize"',
    `from ${JSON.stringify(
      new URL("../src/lib/shopling/shoplingNormalize.ts", import.meta.url).href,
    )}`,
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "productMasterShoplingDiagnosticEngine.ts",
  }).outputText;
  const file = join(directory, "productMasterShoplingDiagnosticEngine.mjs");
  await writeFile(file, output);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const { buildProductMasterShoplingDiagnostic } = await loadEngine();

function sku(overrides = {}) {
  return {
    skuId: "sku-1",
    modelNo: "AAA001",
    barcode: "BAA1-1",
    productName: "계란펀칭기",
    optionName: "단품",
    skuActive: true,
    listings: [],
    ...overrides,
  };
}

function option(overrides = {}) {
  return {
    goodsKey: "1001",
    optionId: "O1",
    barcode: "BAA1-1",
    partnerOptionCode: "BAA1-1",
    productName: "계란펀칭기 1+1",
    optionName: "단품",
    isActive: true,
    ...overrides,
  };
}

test("exact mapping accepts 1+1 as two base inventory units", () => {
  const report = buildProductMasterShoplingDiagnostic(
    [
      sku({
        listings: [
          { goodsKey: "1001", optionId: "O1", unitsPerOrder: 2, active: true },
        ],
      }),
    ],
    [option()],
    "2026-08-06T00:00:00.000Z",
  );

  assert.equal(report.summary.exactListingMatchCount, 1);
  assert.equal(report.summary.unitsMismatchCount, 0);
  assert.equal(report.summary.blockerCount, 0);
  assert.equal(report.candidates.length, 0);
});

test("intrinsic packaged SKU is one inventory unit when Shopling sells the same package", () => {
  const report = buildProductMasterShoplingDiagnostic(
    [
      sku({
        productName: "세탁기원형받침대 4개입 세트",
        listings: [
          { goodsKey: "1001", optionId: "O1", unitsPerOrder: 1, active: true },
        ],
      }),
    ],
    [
      option({
        productName: "세탁기원형받침대 4개입 세트",
      }),
    ],
  );

  assert.equal(report.summary.unitsMismatchCount, 0);
  assert.equal(
    report.issues.some((issue) => issue.code === "UNITS_PER_ORDER_MISMATCH"),
    false,
  );
});

test("missing listing produces a deterministic mapping candidate and pack ratio", () => {
  const report = buildProductMasterShoplingDiagnostic(
    [sku()],
    [option({ productName: "계란펀칭기 5개입", optionId: "O5" })],
  );

  assert.equal(report.summary.missingListingCandidateCount, 1);
  assert.equal(report.candidates[0].expectedUnitsPerOrder, 5);
  assert.equal(report.candidates[0].inference, "EXPLICIT_PACK_RATIO");
  assert.equal(
    report.issues.some((issue) => issue.code === "MISSING_PRODUCT_MASTER_LISTING"),
    true,
  );
});

test("barcode and partner option code conflict is a blocker and is never auto-mapped", () => {
  const report = buildProductMasterShoplingDiagnostic(
    [sku()],
    [option({ partnerOptionCode: "BAA1-2" })],
  );

  assert.equal(report.summary.barcodeConflictCount, 1);
  assert.equal(report.summary.blockerCount, 1);
  assert.equal(report.candidates.length, 0);
  assert.equal(report.issues[0].code, "SHOPLING_BARCODE_CONFLICT");
});

test("orphan Shopling codes and stale Product Master listings stay review-only", () => {
  const report = buildProductMasterShoplingDiagnostic(
    [
      sku({
        listings: [
          { goodsKey: "OLD", optionId: "OLD-O", unitsPerOrder: 1, active: true },
        ],
      }),
    ],
    [
      option({
        goodsKey: "2002",
        optionId: "O2",
        barcode: "BAA9-9",
        partnerOptionCode: "BAA9-9",
      }),
    ],
  );

  assert.equal(report.summary.orphanManagedOptionCount, 1);
  assert.equal(report.summary.staleListingCount, 1);
  assert.equal(report.summary.blockerCount, 0);
  assert.equal(
    report.issues.some(
      (issue) => issue.code === "SHOPLING_BARCODE_NOT_IN_PRODUCT_MASTER",
    ),
    true,
  );
  assert.equal(
    report.issues.some((issue) => issue.code === "STALE_PRODUCT_MASTER_LISTING"),
    true,
  );
});

test("non-divisible package ratios are never guessed", () => {
  const report = buildProductMasterShoplingDiagnostic(
    [sku({ productName: "테스트상품 2개입" })],
    [option({ productName: "테스트상품 3개입", optionId: "O3" })],
  );

  assert.equal(report.candidates[0].expectedUnitsPerOrder, null);
  assert.equal(report.candidates[0].inference, "AMBIGUOUS");
  assert.equal(
    report.issues.find((issue) => issue.code === "MISSING_PRODUCT_MASTER_LISTING")
      ?.expectedUnitsPerOrder,
    null,
  );
});

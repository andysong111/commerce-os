import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadEngine() {
  const testDirectory = dirname(new URL(import.meta.url).pathname);
  const directory = await mkdtemp(join(testDirectory, ".product-master-mapping-apply-"));
  const sourcePath = new URL(
    "../src/lib/productMasterShoplingMappingApplyEngine.ts",
    import.meta.url,
  );
  const source = await readFile(sourcePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "productMasterShoplingMappingApplyEngine.ts",
  }).outputText;
  const file = join(directory, "productMasterShoplingMappingApplyEngine.mjs");
  await writeFile(file, output);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const { buildProductMasterShoplingMappingApplyPlan } = await loadEngine();

function candidate(overrides = {}) {
  return {
    skuId: "sku-1",
    barcode: "BAA1-1",
    modelNo: "AAA001",
    goodsKey: "116459",
    optionId: "2780757",
    productName: "테스트상품",
    optionName: "단품",
    expectedUnitsPerOrder: 1,
    inference: "DEFAULT_SINGLE",
    evidence: ["단품"],
    ...overrides,
  };
}

function report(overrides = {}) {
  const candidates = overrides.candidates ?? [candidate()];
  return {
    generatedAt: "2026-08-07T09:00:00.000Z",
    summary: {
      planningSkuCount: 1,
      shoplingActiveOptionCount: candidates.length,
      managedShoplingOptionCount: candidates.length,
      ignoredUnmanagedOptionCount: 0,
      matchedSkuCount: 1,
      exactListingMatchCount: 0,
      missingListingCandidateCount: candidates.length,
      staleListingCount: 0,
      unitsMismatchCount: 0,
      orphanManagedOptionCount: 0,
      barcodeConflictCount: 0,
      duplicateShoplingIdentityCount: 0,
      blockerCount: 0,
      reviewCount: candidates.length,
      readyForMappingReview: true,
      ...(overrides.summary ?? {}),
    },
    candidates,
    issues: [],
  };
}

function planning(overrides = {}) {
  return {
    skuId: "sku-1",
    modelNo: "AAA001",
    barcode: "BAA1-1",
    productName: "테스트상품",
    optionName: "단품",
    skuActive: true,
    listings: [],
    ...overrides,
  };
}

test("clean diagnostic candidate becomes a deterministic pending mapping", () => {
  const plan = buildProductMasterShoplingMappingApplyPlan(
    report(),
    [planning()],
    "2026-08-07T09:10:00.000Z",
  );

  assert.equal(plan.blockerCount, 0);
  assert.equal(plan.pendingCount, 1);
  assert.equal(plan.alreadyAppliedCount, 0);
  assert.equal(plan.readyForCanary, true);
  assert.equal(plan.pending[0].id, "shopling-auto:116459:2780757:BAA1-1");
  assert.equal(plan.pending[0].unitsPerOrder, 1);
});

test("an exact current Product Master listing is idempotently recognized as already applied", () => {
  const plan = buildProductMasterShoplingMappingApplyPlan(report(), [
    planning({
      listings: [
        {
          goodsKey: "116459",
          optionId: "2780757",
          unitsPerOrder: 1,
          active: true,
        },
      ],
    }),
  ]);

  assert.equal(plan.blockerCount, 0);
  assert.equal(plan.pendingCount, 0);
  assert.equal(plan.alreadyAppliedCount, 1);
});

test("the same Shopling identity on another SKU is fail-closed", () => {
  const plan = buildProductMasterShoplingMappingApplyPlan(report(), [
    planning(),
    planning({
      skuId: "sku-2",
      barcode: "BAA1-2",
      listings: [
        {
          goodsKey: "116459",
          optionId: "2780757",
          unitsPerOrder: 1,
          active: true,
        },
      ],
    }),
  ]);

  assert.equal(plan.pendingCount, 0);
  assert.equal(plan.blockerCount, 1);
  assert.equal(plan.blockers[0].code, "SHOPLING_IDENTITY_CONFLICT");
});

test("barcode changes after the diagnostic block automatic mapping", () => {
  const plan = buildProductMasterShoplingMappingApplyPlan(
    report(),
    [planning({ barcode: "BAA1-9" })],
  );

  assert.equal(plan.pendingCount, 0);
  assert.equal(plan.blockerCount, 1);
  assert.equal(plan.blockers[0].code, "BARCODE_CHANGED");
});

test("ambiguous pack ratios and missing option ids are never auto-applied", () => {
  const ambiguous = candidate({
    goodsKey: "2001",
    optionId: "A1",
    expectedUnitsPerOrder: null,
    inference: "AMBIGUOUS",
  });
  const missingOption = candidate({ goodsKey: "2002", optionId: "" });
  const plan = buildProductMasterShoplingMappingApplyPlan(
    report({ candidates: [ambiguous, missingOption] }),
    [planning()],
  );

  assert.equal(plan.pendingCount, 0);
  assert.equal(plan.blockerCount, 2);
  assert.deepEqual(
    new Set(plan.blockers.map((row) => row.code)),
    new Set(["INVALID_CANDIDATE", "OPTION_ID_REQUIRED"]),
  );
});

test("diagnostic blockers prevent any canary even if a candidate itself looks valid", () => {
  const plan = buildProductMasterShoplingMappingApplyPlan(
    report({ summary: { blockerCount: 1, readyForMappingReview: false } }),
    [planning()],
  );

  assert.equal(plan.blockerCount, 1);
  assert.equal(plan.readyForCanary, false);
});

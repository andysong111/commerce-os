import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadComparisonModule() {
  const testDirectory = dirname(new URL(import.meta.url).pathname);
  const directory = await mkdtemp(join(testDirectory, ".price-grade-shadow-"));
  const stub = join(directory, "supabase-admin.mjs");
  await writeFile(
    stub,
    'export function createSupabaseAdminHeaders() { return {}; }\n',
  );
  let source = await readFile(
    new URL("../src/lib/priceGradeShadowComparison.ts", import.meta.url),
    "utf8",
  );
  source = source
    .replace(
      'from "@/lib/supabase/admin"',
      `from ${JSON.stringify(pathToFileURL(stub).href)}`,
    )
    .replace(
      'from "@/lib/priceGradeEngine"',
      `from ${JSON.stringify(
        new URL("../src/lib/priceGradeEngine.ts", import.meta.url).href,
      )}`,
    );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "priceGradeShadowComparison.ts",
  }).outputText;
  const file = join(directory, "priceGradeShadowComparison.mjs");
  await writeFile(file, output);
  try {
    return await import(`${pathToFileURL(file).href}?v=${Date.now()}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const comparison = await loadComparisonModule();
const { comparePriceGradeInputs } = comparison;
const CURRENT_SOURCE = "commerce-os-price-grade-v1.0.0";

function baseInput(overrides = {}) {
  return {
    skuId: crypto.randomUUID(),
    barcode: "BAA1-1",
    productName: "테스트 상품",
    optionName: "단품",
    currentPrice: 1000,
    currentGrade: 0,
    launchedAt: "2025-01-01T00:00:00.000Z",
    lastSaleAt: "2026-08-01T00:00:00.000Z",
    monthlyUnits: Array.from({ length: 24 }, () => 10),
    receipts: [
      {
        receivedAt: "2026-07-01T00:00:00.000Z",
        unitCostKrw: 300,
        quantity: 100,
      },
    ],
    discontinued: false,
    active: true,
    markdownStage: 0,
    latestInputAt: "2026-08-01T00:00:00.000Z",
    existingLifecycle: {
      grade: 0,
      basePrice: 1000,
      targetPrice: 1000,
      protectionFloor: 600,
      clearanceStage: 0,
      lifecycleStatus: "ACTIVE",
      reorderingAllowed: true,
      discontinued: false,
      gradeReason: "유지",
      calculatedAt: "2026-08-02T00:00:00.000Z",
      source: CURRENT_SOURCE,
      shadowMode: true,
    },
    ...overrides,
  };
}

test("comparison separates exact, stale, legacy, blocked, missing and unexplained results", () => {
  const inputs = [
    baseInput({ skuId: "exact" }),
    baseInput({
      skuId: "stale",
      existingLifecycle: {
        ...baseInput().existingLifecycle,
        calculatedAt: "2026-07-01T00:00:00.000Z",
      },
    }),
    baseInput({
      skuId: "legacy",
      existingLifecycle: {
        ...baseInput().existingLifecycle,
        source: "legacy-price-adjustment-engine",
      },
    }),
    baseInput({
      skuId: "unexplained",
      existingLifecycle: {
        ...baseInput().existingLifecycle,
        targetPrice: 900,
      },
    }),
    baseInput({
      skuId: "blocked",
      receipts: [],
    }),
    baseInput({
      skuId: "missing",
      existingLifecycle: null,
    }),
  ];
  const result = comparePriceGradeInputs(
    {
      ok: true,
      generatedAt: "2026-08-05T00:00:00.000Z",
      contentFingerprint: `sha256:${"a".repeat(64)}`,
      inputCount: inputs.length,
      inputs,
    },
    "run-1",
  );

  assert.equal(result.runId, "run-1");
  assert.equal(result.writesEnabled, false);
  assert.equal(result.summary.inputCount, 6);
  assert.equal(result.summary.exactMatchCount, 1);
  assert.equal(result.summary.mismatchCount, 5);
  assert.equal(result.summary.staleExistingCount, 1);
  assert.equal(result.summary.differentRuleSourceCount, 1);
  assert.equal(result.summary.unexplainedCount, 1);
  assert.equal(result.summary.blockedCount, 1);
  assert.equal(result.summary.missingExistingCount, 1);
  assert.deepEqual(
    new Set(result.mismatches.map((row) => row.kind)),
    new Set([
      "existing_stale_input",
      "different_rule_source",
      "unexplained_difference",
      "engine_blocked",
      "missing_existing_lifecycle",
    ]),
  );
});

test("comparison result stores only bounded mismatch samples and never enables writes", () => {
  const inputs = Array.from({ length: 600 }, (_, index) =>
    baseInput({
      skuId: `missing-${index}`,
      barcode: `BAA${index + 1}-1`,
      existingLifecycle: null,
    }),
  );
  const result = comparePriceGradeInputs({
    ok: true,
    generatedAt: "2026-08-05T00:00:00.000Z",
    contentFingerprint: `sha256:${"b".repeat(64)}`,
    inputCount: inputs.length,
    inputs,
  });
  assert.equal(result.summary.mismatchCount, 600);
  assert.equal(result.summary.sampleCount, 500);
  assert.equal(result.summary.sampleTruncated, true);
  assert.equal(result.mismatches.length, 500);
  assert.equal(result.writesEnabled, false);
});

test("API is same-origin, comparison-only and does not call a price runner", async () => {
  const [route, service, page, control, registry] = await Promise.all([
    readFile(
      "src/app/api/price-adjustment-engine/shadow-compare/route.ts",
      "utf8",
    ),
    readFile("src/lib/priceGradeShadowComparison.ts", "utf8"),
    readFile("src/app/price-adjustment-engine/shadow-compare/page.tsx", "utf8"),
    readFile(
      "src/app/price-adjustment-engine/shadow-compare/ShadowCompareControl.tsx",
      "utf8",
    ),
    readFile("src/lib/extendedModuleRegistry.ts", "utf8"),
  ]);
  assert.match(route, /isSameOriginOpsRequest/);
  assert.match(route, /runPriceGradeShadowComparison/);
  assert.match(service, /PRICE_GRADE_SHADOW_COMPARISON/);
  assert.match(service, /resolution=ignore-duplicates/);
  assert.match(page, /운영 전환 차단 상태/);
  assert.match(control, /실제 가격변경·상품등급 저장·재발주 제한 적용은 모두 차단/);
  assert.match(registry, /price-grade-shadow-comparison/);
  assert.match(registry, /\/price-adjustment-engine\/shadow-compare/);
  for (const source of [route, service, page, control]) {
    assert.doesNotMatch(source, /shopling-price-adjustment-runner/);
    assert.doesNotMatch(source, /1688/i);
  }
});

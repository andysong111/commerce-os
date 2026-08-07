import { readFile, writeFile, unlink } from "node:fs/promises";

const enginePath = "src/lib/productMasterShoplingSalesIncrementalEngine.ts";
const testPath = "tests/productMasterShoplingSalesIncrementalEngine.test.mjs";
const workflowPath = ".github/workflows/temporary-incremental-sales-timestamp-normalization.yml";
const selfPath = "scripts/patch-incremental-sales-timestamp-normalization.mjs";

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`PATCH_SOURCE_MISSING:${label}`);
  return source.replace(before, after);
}

let engine = await readFile(enginePath, "utf8");
engine = replaceOnce(
  engine,
`function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normalizeBarcode(value: unknown) {`,
`function integer(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normalizedIso(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw;
}

function normalizeBarcode(value: unknown) {`,
  "add normalized ISO helper",
);
engine = replaceOnce(
  engine,
`    (actual.lastSaleAt ?? null) === (expected.lastSaleAt ?? null) &&
    actual.source === SHOPLING_CANONICAL_SALES_SOURCE`,
`    normalizedIso(actual.lastSaleAt) === normalizedIso(expected.lastSaleAt) &&
    actual.source === SHOPLING_CANONICAL_SALES_SOURCE`,
  "normalize verification timestamps",
);
await writeFile(enginePath, engine);

let tests = await readFile(testPath, "utf8");
tests += `\n\ntest("verification treats equivalent timestamptz representations as the same instant", () => {\n  const expected = {\n    ...sales("BAA1-1", "2026-08", 8),\n    skuId: "sku-a",\n    lastSaleAt: "2026-08-20T10:00:00.000Z",\n  };\n  const actual = {\n    ...existing("sku-a", "BAA1-1", "2026-08", 8),\n    lastSaleAt: "2026-08-20T10:00:00+00:00",\n  };\n  assert.equal(exactShoplingIncrementalSales(expected, actual), true);\n});\n\ntest("verification still rejects a genuinely different sale timestamp", () => {\n  const expected = {\n    ...sales("BAA1-1", "2026-08", 8),\n    skuId: "sku-a",\n    lastSaleAt: "2026-08-20T10:00:00.000Z",\n  };\n  const actual = {\n    ...existing("sku-a", "BAA1-1", "2026-08", 8),\n    lastSaleAt: "2026-08-20T10:00:01+00:00",\n  };\n  assert.equal(exactShoplingIncrementalSales(expected, actual), false);\n});\n`;
await writeFile(testPath, tests);

await unlink(workflowPath).catch(() => undefined);
await unlink(selfPath).catch(() => undefined);

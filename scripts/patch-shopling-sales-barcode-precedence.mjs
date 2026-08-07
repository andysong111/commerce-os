import { readFile, writeFile, unlink } from "node:fs/promises";

const enginePath = "src/lib/productMasterShoplingSalesBackfillEngine.ts";
const testPath = "tests/productMasterShoplingSalesBackfillEngine.test.mjs";
const workflowPath = ".github/workflows/temporary-shopling-sales-barcode-precedence-patch.yml";
const selfPath = "scripts/patch-shopling-sales-barcode-precedence.mjs";

function replaceOnce(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`PATCH_SOURCE_MISSING:${label}`);
  const next = source.replace(before, after);
  if (next === source) throw new Error(`PATCH_NO_CHANGE:${label}`);
  return next;
}

let engine = await readFile(enginePath, "utf8");

engine = replaceOnce(
  engine,
`function rawStructuredCode(row: ShoplingRawRow) {
  for (const key of [
    "ptn_goods_cd",
    "buying_cd",
    "mall_ptn_goods_cd",
    "mall_opt_cd",
    "opt_barcode",
    "barcode",
  ]) {
    const code = normalizedStructuredCode(rawValue(row, [key]));
    if (code) return code;
  }
  return "";
}

function rawManagedCode(row: ShoplingRawRow) {
  const structured = rawStructuredCode(row);
  return managedBarcode(structured);
}
`,
`function firstStructuredCode(row: ShoplingRawRow, keys: string[]) {
  for (const key of keys) {
    const code = normalizedStructuredCode(rawValue(row, [key]));
    if (code) return code;
  }
  return "";
}

function rawOptionStructuredCode(row: ShoplingRawRow) {
  return firstStructuredCode(row, ["optBarcode", "opt_barcode", "barcode"]);
}

function rawPartnerStructuredCode(row: ShoplingRawRow) {
  return firstStructuredCode(row, [
    "ptn_goods_cd",
    "buying_cd",
    "mall_ptn_goods_cd",
    "mall_opt_cd",
  ]);
}

function rawManagedCode(row: ShoplingRawRow) {
  return managedBarcode(
    rawOptionStructuredCode(row) || rawPartnerStructuredCode(row),
  );
}
`,
  "split barcode and partner code evidence",
);

engine = replaceOnce(
  engine,
`function isManagedSalesScope(
  index: PlanningIndex,
  order: ReturnType<typeof normalizeShoplingOrder>,
  raw: ShoplingRawRow,
) {
  const rawCode = rawStructuredCode(raw) || normalizedStructuredCode(order.barcode);
  if (rawCode) return Boolean(managedBarcode(rawCode));

  const optionId = text(order.optionId);
  if (optionId && index.managedOptionIds.has(optionId)) return true;

  for (const key of [text(order.productId), text(order.mallProductKey)]) {
    if (key && index.byGoodsKey.has(key)) return true;
  }
  return false;
}
`,
`function isManagedSalesScope(
  index: PlanningIndex,
  order: ReturnType<typeof normalizeShoplingOrder>,
  raw: ShoplingRawRow,
) {
  // The option barcode is the strongest evidence for whether the historical
  // order belonged to the warehouse-managed B-code catalog. Product-level
  // partner codes must not override an exact managed option identity.
  const optionCode =
    rawOptionStructuredCode(raw) || normalizedStructuredCode(order.barcode);
  if (optionCode) return Boolean(managedBarcode(optionCode));

  const optionId = text(order.optionId);
  if (optionId && index.managedOptionIds.has(optionId)) return true;

  const partnerCode = rawPartnerStructuredCode(raw);
  if (partnerCode) return Boolean(managedBarcode(partnerCode));

  for (const key of [text(order.productId), text(order.mallProductKey)]) {
    if (key && index.byGoodsKey.has(key)) return true;
  }
  return false;
}
`,
  "managed sales scope precedence",
);

engine = replaceOnce(
  engine,
`function resolveIdentity(
  index: PlanningIndex,
  order: ReturnType<typeof normalizeShoplingOrder>,
  raw: ShoplingRawRow,
) {
  const optionId = text(order.optionId);
  const optionIdentity = optionId ? index.byOptionId.get(optionId) ?? null : null;
  const directCode = rawManagedCode(raw) || managedBarcode(order.barcode);

  if (directCode) {
    if (optionIdentity) {
      return optionIdentity.barcode === directCode ? optionIdentity : null;
    }

    const currentDirect = index.byBarcode.get(directCode);
    if (currentDirect) return currentDirect;

    const historicalDirect = historicalDirectIdentity(index, directCode, order);
    if (historicalDirect) return historicalDirect;

    for (const key of [text(order.productId), text(order.mallProductKey)]) {
      const identity = key ? index.byGoodsKey.get(key) : null;
      if (identity?.barcode === directCode) return identity;
    }
    return null;
  }

  if (optionIdentity) return optionIdentity;
  for (const key of [text(order.productId), text(order.mallProductKey)]) {
    if (key && index.byGoodsKey.has(key)) return index.byGoodsKey.get(key)!;
  }
  return null;
}
`,
`function resolveIdentity(
  index: PlanningIndex,
  order: ReturnType<typeof normalizeShoplingOrder>,
  raw: ShoplingRawRow,
) {
  const optionId = text(order.optionId);
  const optionIdentity = optionId ? index.byOptionId.get(optionId) ?? null : null;
  const optionBarcode = managedBarcode(
    rawOptionStructuredCode(raw) || order.barcode,
  );

  // A real option barcode is historical SKU evidence. When it exists we keep
  // the sale on that B-code even if the same optionId is currently attached to
  // another SKU after later catalog edits. Pack size must still be deterministic.
  if (optionBarcode) {
    if (optionIdentity?.barcode === optionBarcode) return optionIdentity;

    const currentDirect = index.byBarcode.get(optionBarcode);
    if (currentDirect) return currentDirect;

    const historicalDirect = historicalDirectIdentity(
      index,
      optionBarcode,
      order,
    );
    if (historicalDirect) return historicalDirect;

    for (const key of [text(order.productId), text(order.mallProductKey)]) {
      const identity = key ? index.byGoodsKey.get(key) : null;
      if (identity?.barcode === optionBarcode) return identity;
    }
    return null;
  }

  // Exact current option identity is stronger than product-level partner codes
  // such as ptn_goods_cd. Those fields frequently carry one representative
  // product code across several options and must not create false conflicts.
  if (optionIdentity) return optionIdentity;

  const partnerCode = managedBarcode(rawPartnerStructuredCode(raw));
  if (partnerCode) {
    const currentDirect = index.byBarcode.get(partnerCode);
    if (currentDirect) return currentDirect;

    const historicalDirect = historicalDirectIdentity(index, partnerCode, order);
    if (historicalDirect) return historicalDirect;

    for (const key of [text(order.productId), text(order.mallProductKey)]) {
      const identity = key ? index.byGoodsKey.get(key) : null;
      if (identity?.barcode === partnerCode) return identity;
    }
    return null;
  }

  for (const key of [text(order.productId), text(order.mallProductKey)]) {
    if (key && index.byGoodsKey.has(key)) return index.byGoodsKey.get(key)!;
  }
  return null;
}
`,
  "source-aware identity precedence",
);

await writeFile(enginePath, engine);

let test = await readFile(testPath, "utf8");
test = replaceOnce(
  test,
`test("explicit B-code conflict with a current exact option never guesses", () => {
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "O1", prod_id: "1001", ptn_goods_cd: "BBA4-1" })],
    planning(),
    range,
  );
  assert.equal(result.acceptedRows, 0);
  assert.equal(result.unmappedRows, 1);
});
`,
`test("product-level partner B-code never overrides an exact current option identity", () => {
  const result = aggregateProductMasterShoplingSalesChunk(
    [order({ opt_id: "O1", prod_id: "1001", ptn_goods_cd: "BBA4-1" })],
    planning(),
    range,
  );
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.monthlyRows[0].barcode, "BAA1-1");
  assert.equal(result.monthlyRows[0].quantity, 6);
});

test("actual option barcode remains authoritative over a later current option mapping", () => {
  const historical = planning({
    products: [
      {
        skuId: "current",
        barcode: "BAA1-1",
        productName: "현재상품",
        optionName: "현재옵션",
        skuActive: true,
        listings: [
          { goodsKey: "1001", optionId: "O1", unitsPerOrder: 2, active: true },
        ],
      },
      {
        skuId: "historical",
        barcode: "BBA4-1",
        productName: "과거상품",
        optionName: "과거옵션",
        skuActive: false,
        listings: [
          { goodsKey: "OLD", optionId: "OLD", unitsPerOrder: 1, active: false },
        ],
      },
    ],
  });
  const result = aggregateProductMasterShoplingSalesChunk(
    [
      order({
        opt_id: "O1",
        prod_id: "1001",
        opt_barcode: "BBA4-1",
        ptn_goods_cd: "BAA1-1",
        mall_ord_cnt: "3",
      }),
    ],
    historical,
    range,
  );
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.unmappedRows, 0);
  assert.equal(result.monthlyRows[0].barcode, "BBA4-1");
  assert.equal(result.monthlyRows[0].quantity, 3);
});
`,
  "barcode precedence tests",
);
await writeFile(testPath, test);

await unlink(workflowPath).catch(() => undefined);
await unlink(selfPath).catch(() => undefined);

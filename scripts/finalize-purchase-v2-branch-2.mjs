import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function edit(relativePath, transform) {
  const target = path.join(root, relativePath);
  const before = await readFile(target, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(target, after, "utf8");
}

await edit("src/lib/inventoryLifecycleLedger.ts", (source) => {
  let next = source.replace(
    "function buildExactInventory(input: {",
    "export function buildExactInventory(input: {",
  );
  next = next.replace(
    /const grouped = new Map<string, ReturnType<typeof parseChinaEvent>\[\] & unknown\[\]>\(\);[\s\S]*?const deltas: ReceiptDelta\[\] = \[\];\n  for \(const rawEvents of grouped\.values\(\)\) \{\n    const events = \(rawEvents as NonNullable<\n      ReturnType<typeof parseChinaEvent>\n    >\[\]\)\.sort\(/,
    `const grouped = new Map<\n    string,\n    NonNullable<ReturnType<typeof parseChinaEvent>>[]\n  >();\n  for (const row of rows) {\n    const event = parseChinaEvent(row);\n    if (!event) continue;\n    const key = \`${"${event.sourceSystem}"}\\u0000${"${event.sourceLineId}"}\\u0000${"${event.barcode}"}\`;\n    const current = grouped.get(key) ?? [];\n    current.push(event);\n    grouped.set(key, current);\n  }\n\n  const deltas: ReceiptDelta[] = [];\n  for (const events of grouped.values()) {\n    events.sort(`,
  );
  if (next.includes("grouped.set(key, current as never)")) {
    throw new Error("INVENTORY_GROUPED_TYPE_PATCH_FAILED");
  }
  if (!next.includes("export function buildExactInventory")) {
    throw new Error("INVENTORY_BUILD_EXPORT_PATCH_FAILED");
  }
  return next;
});

await edit("src/app/api/inventory-lifecycle/route.ts", (source) => {
  let next = source.replace(
    `function productMode(value: unknown): ShoplingInventoryProductMode {\n  return text(value).toUpperCase() === "SINGLE" ? "SINGLE" : "OPTION";\n}`,
    `function productMode(value: unknown): ShoplingInventoryProductMode | null {\n  const normalized = text(value).toUpperCase();\n  if (normalized === "SINGLE" || normalized === "OPTION") return normalized;\n  return null;\n}`,
  );
  next = next.replace(
    `    const mode = productMode(body.productMode);\n    const modelNo`,
    `    const requestedMode = productMode(body.productMode);\n    const modelNo`,
  );
  next = next.replace(
    `    if (action === "STOCKOUT") {\n      const reset`,
    `    if (action === "STOCKOUT") {\n      if (!requestedMode) throw new Error("INVENTORY_PRODUCT_MODE_REQUIRED");\n      const mode = requestedMode;\n      const reset`,
  );
  next = next.replace(
    `        productMode: mode || row.productMode,`,
    `        productMode: requestedMode ?? row.productMode,`,
  );
  next = next.replace(
    `        productMode: mode,\n        desiredStatus: desiredStatus as`,
    `        productMode: requestedMode ?? "OPTION",\n        desiredStatus: desiredStatus as`,
  );
  if (next.includes("const mode = productMode(body.productMode)")) {
    throw new Error("INVENTORY_ROUTE_MODE_PATCH_FAILED");
  }
  return next;
});

await edit(
  "src/app/api/shopling-inventory-lifecycle-extension/download/route.ts",
  (source) => source.replace("return new Response(zip, {", "return new Response(new Uint8Array(zip), {"),
);

console.log("PURCHASE_V2_BRANCH_FINALIZER_2_OK");

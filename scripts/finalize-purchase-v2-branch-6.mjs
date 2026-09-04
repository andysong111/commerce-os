import { readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function edit(relativePath, transform) {
  const target = path.join(root, relativePath);
  const before = await readFile(target, "utf8");
  const after = transform(before);
  if (typeof after !== "string" || !after.length) {
    throw new Error(`INVALID_FINALIZER_OUTPUT:${relativePath}`);
  }
  if (after !== before) await writeFile(target, after, "utf8");
}

await edit("src/app/api/china-order-ledger/events/route.ts", (source) => {
  if (source.includes("Awaited<ReturnType<typeof createPendingShoplingInventorySync>>")) {
    return source;
  }
  return source.replace(
    "    let automaticSellingJob = null;",
    "    let automaticSellingJob: Awaited<\n      ReturnType<typeof createPendingShoplingInventorySync>\n    > | null = null;",
  );
});

await edit(".github/workflows/purchase-v2-ci.yml", (source) => {
  const start = source.indexOf("      - name: Apply one-time release finalizers");
  const end = source.indexOf("\n      - name: Check extension JavaScript syntax", start);
  if (start < 0 || end < 0) {
    if (source.includes("Verify finalized source layout")) return source;
    throw new Error("PURCHASE_V2_FINAL_WORKFLOW_PATCH_ANCHOR_MISSING");
  }
  const replacement = `      - name: Verify finalized source layout\n        run: |\n          test -f src/lib/productDecisionEngine/purchaseV2.ts\n          test -f src/lib/inventoryLifecycleLedger.ts\n          test -f public/shopling-inventory-lifecycle/manifest.json\n          grep -q '"version": "0.1.2"' public/shopling-inventory-lifecycle/manifest.json\n`;
  return source.slice(0, start) + replacement + source.slice(end + 1);
});

for (const relativePath of [
  ".github/workflows/purchase-v2-stockout-lifecycle-ci.yml",
  ".github/workflows/purchase-v2-complete-ci.yml",
  ".github/workflows/purchase-v2-authoritative-ci.yml",
  ".github/workflows/purchase-v2-release-candidate-ci.yml",
]) {
  await rm(path.join(root, relativePath), { force: true });
}

for (const relativePath of [
  "scripts/finalize-purchase-v2-branch.mjs",
  "scripts/finalize-purchase-v2-branch-2.mjs",
  "scripts/finalize-purchase-v2-branch-3.mjs",
  "scripts/finalize-purchase-v2-branch-4.mjs",
  "scripts/finalize-purchase-v2-branch-5.mjs",
  "scripts/finalize-purchase-v2-branch-6.mjs",
]) {
  await rm(path.join(root, relativePath), { force: true });
}

console.log("PURCHASE_V2_RELEASE_SOURCE_CONSOLIDATED");

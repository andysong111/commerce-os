import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function edit(relativePath, transform) {
  const target = path.join(root, relativePath);
  const before = await readFile(target, "utf8");
  const after = transform(before);
  if (after === before) return false;
  await writeFile(target, after, "utf8");
  return true;
}

await edit("public/shopling-inventory-lifecycle/content-shopling.js", (source) => {
  let next = source
    .replace('  const VERSION = "0.1.0";', '  const VERSION = "0.1.1";')
    .replace("  const handled = new Set();\n", "")
    .replace("    if (handled.has(key)) return;\n", "")
    .replace("    let actionable = false;\n", "")
    .replace(/\n\s*actionable = true;/g, "")
    .replace("\n    if (actionable) handled.add(key);", "");
  if (/\bhandled\b|\bactionable\b/.test(next)) {
    throw new Error("CONTENT_SHOPLING_IDEMPOTENCY_PATCH_INCOMPLETE");
  }
  return next;
});

for (const file of [
  "public/shopling-inventory-lifecycle/background.js",
  "public/shopling-inventory-lifecycle/content-ops.js",
]) {
  await edit(file, (source) =>
    source.replaceAll('"0.1.0"', '"0.1.1"'),
  );
}

await edit("public/shopling-inventory-lifecycle/manifest.json", (source) =>
  source
    .replace('"version": "0.1.0"', '"version": "0.1.1"')
    .replace(
      "B코드 품절 시 A6→A22 또는 A6→A21로 품절을 전송하고, 확정입고 후 같은 경로로 판매중을 복구합니다.",
      "B코드 품절 시 A6→A22 또는 A6→A21로 품절을 전송하고, 확정입고 후 같은 경로로 판매중을 복구합니다. 한 번에 1개 B코드만 직렬 처리합니다.",
    ),
);

await edit("public/shopling-inventory-lifecycle/popup.html", (source) =>
  source.replace("COMMERCE OS · v0.1.0", "COMMERCE OS · v0.1.1"),
);
await edit("public/shopling-inventory-lifecycle/README.txt", (source) =>
  source.replace("v0.1.0", "v0.1.1"),
);
await edit(
  "src/app/api/shopling-inventory-lifecycle-extension/download/route.ts",
  (source) => source.replaceAll("v0.1.0", "v0.1.1"),
);

await edit(
  "src/components/china-order-manager/ChinaOrderManagerNav.tsx",
  (source) => {
    if (source.includes("/china-order-manager/purchase-v2")) return source;
    const link = `\n        <a\n          href="/china-order-manager/purchase-v2"\n          className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-black text-blue-900 hover:bg-blue-100"\n        >\n          발주 V2 · 품절/판매중\n        </a>`;
    const navClose = source.lastIndexOf("</nav>");
    if (navClose >= 0) {
      return source.slice(0, navClose) + link + "\n      " + source.slice(navClose);
    }
    const divClose = source.lastIndexOf("</div>");
    if (divClose >= 0) {
      return source.slice(0, divClose) + link + "\n      " + source.slice(divClose);
    }
    throw new Error("CHINA_ORDER_MANAGER_NAV_INSERTION_POINT_NOT_FOUND");
  },
);

console.log("PURCHASE_V2_BRANCH_FINALIZER_OK");

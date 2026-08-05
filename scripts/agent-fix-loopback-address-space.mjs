import { readFileSync, writeFileSync } from "node:fs";

// 127.0.0.1 belongs to the loopback address space in current LNA implementations.
const files = [
  "public/product-launch-tracker-app/detail-page-dock.js",
  "public/product-launch-tracker-app/category-local-update.js",
  "public/product-launch-tracker-app/category-local-result-recovery.js",
  "src/components/OpsCategoryUpdateCancelControl.tsx",
  "tests/productLaunchTrackerDetailPageDock.test.mjs",
  "tests/shoplingCategoryLocalUpdate.test.mjs",
];

let changed = 0;
for (const path of files) {
  const source = readFileSync(path, "utf8");
  const occurrences = source.split('targetAddressSpace: "local"').length - 1;
  if (occurrences < 1) {
    throw new Error(`${path}: expected at least one local targetAddressSpace`);
  }
  const next = source.split('targetAddressSpace: "local"').join('targetAddressSpace: "loopback"');
  writeFileSync(path, next);
  changed += occurrences;
}

if (changed < 6) throw new Error(`expected at least 6 replacements, got ${changed}`);
console.log(`replaced ${changed} localhost address-space annotations with loopback`);

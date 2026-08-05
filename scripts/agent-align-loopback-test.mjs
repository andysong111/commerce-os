import { readFileSync, writeFileSync } from "node:fs";

// Align the last stale category-runner assertion with 127.0.0.1 loopback semantics.
const path = "tests/shoplingCategoryLocalUpdate.test.mjs";
let source = readFileSync(path, "utf8");
const before = `  assert.match(local, /targetAddressSpace:\\s*"local"/);\n  assert.doesNotMatch(local, /targetAddressSpace:\\s*"loopback"/);`;
const after = `  assert.match(local, /targetAddressSpace:\\s*"loopback"/);\n  assert.doesNotMatch(local, /targetAddressSpace:\\s*"local"/);`;
if (!source.includes(before)) throw new Error("stale local address-space assertion not found");
source = source.replace(before, after);
writeFileSync(path, source);

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bridge = await readFile(
  new URL(
    "../src/components/china-order-manager/InternalChinaDraftInlineQuantityBridge.tsx",
    import.meta.url,
  ),
  "utf8",
);
const page = await readFile(
  new URL("../src/app/china-order-manager/drafts/[draftId]/page.tsx", import.meta.url),
  "utf8",
);

test("China draft quantity can be changed directly inside each order table row", () => {
  assert.match(bridge, /findQuantityTargets/);
  assert.match(bridge, /label === "수량"/);
  assert.match(bridge, /createPortal/);
  assert.match(bridge, /aria-label=\{`\$\{barcode\} 주문수량`\}/);
  assert.match(bridge, />\s*변경\s*</);
});

test("inline quantity change preserves current order-entry work and refreshes totals without full reload", () => {
  assert.match(bridge, /saveCurrentDraftInputs/);
  assert.match(bridge, /\/quantity`/);
  assert.match(bridge, /targetQuantity/);
  assert.match(bridge, /router\.refresh\(\)/);
  assert.doesNotMatch(bridge, /window\.location\.reload/);
});

test("draft page removes the separate top quantity editor and mounts inline controls", () => {
  assert.match(page, /InternalChinaDraftInlineQuantityBridge/);
  assert.doesNotMatch(page, /InternalChinaDraftQuantityEditor/);
  assert.match(page, /각 행의 수량 칸에서 직접 변경/);
});

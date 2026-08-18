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
const quantityRoute = await readFile(
  new URL(
    "../src/app/api/china-order-manager/drafts/[draftId]/quantity/route.ts",
    import.meta.url,
  ),
  "utf8",
);

test("China draft quantity can be changed directly inside each order table row", () => {
  assert.match(bridge, /findQuantityTargets/);
  assert.match(bridge, /label === "수량"/);
  assert.match(bridge, /createPortal/);
  assert.match(bridge, /aria-label=\{`\$\{barcode\} 주문수량`\}/);
  assert.match(bridge, /saving \? "저장" : "변경"/);
});

test("inline quantity change uses a lightweight quantity-only save path", () => {
  assert.match(bridge, /\/quantity`/);
  assert.match(bridge, /targetQuantity/);
  assert.match(bridge, /internal-china-quantity-saved/);
  assert.doesNotMatch(bridge, /saveCurrentDraftInputs/);
  assert.doesNotMatch(bridge, /nativeSaveButton/);
  assert.doesNotMatch(bridge, /router\.refresh\(\)/);
  assert.doesNotMatch(bridge, /window\.location\.reload/);

  const postRoute = quantityRoute.slice(
    quantityRoute.indexOf("export async function POST"),
  );
  assert.match(postRoute, /saveInternalChinaQuantityOverride/);
  assert.doesNotMatch(postRoute, /loadInternalChinaQuantityOverrides/);
  assert.doesNotMatch(postRoute, /applyInternalChinaQuantityOverrides/);
});

test("draft page removes the separate top quantity editor and mounts inline controls", () => {
  assert.match(page, /InternalChinaDraftInlineQuantityBridge/);
  assert.doesNotMatch(page, /InternalChinaDraftQuantityEditor/);
  assert.match(page, /각 행의 수량 칸에서 직접 변경/);
});

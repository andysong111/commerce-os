import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(
  new URL(
    "../src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx",
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

test("China draft quantity controls are rendered natively in every order row", () => {
  assert.match(workspace, /function NativeQuantityControl/);
  assert.match(workspace, /data-native-draft-quantity=\{barcode\}/);
  assert.match(workspace, /aria-label=\{`\$\{barcode\} 주문수량`\}/);
  assert.match(workspace, /saving \? "저장" : "변경"/);
  assert.match(workspace, /<NativeQuantityControl/);
  assert.match(workspace, /수량 · 즉시저장/);
  assert.doesNotMatch(workspace, /createPortal/);
  assert.doesNotMatch(workspace, /findQuantityTargets/);
});

test("native quantity change uses the lightweight quantity-only save path", () => {
  assert.match(workspace, /\/quantity`/);
  assert.match(workspace, /targetQuantity/);
  assert.match(workspace, /applySavedQuantity/);
  assert.doesNotMatch(workspace, /window\.location\.reload/);

  const postRoute = quantityRoute.slice(
    quantityRoute.indexOf("export async function POST"),
  );
  assert.match(postRoute, /saveInternalChinaQuantityOverride/);
  assert.doesNotMatch(postRoute, /loadInternalChinaQuantityOverrides/);
  assert.doesNotMatch(postRoute, /applyInternalChinaQuantityOverrides/);
});

test("draft page no longer mounts the DOM quantity bridge", () => {
  assert.doesNotMatch(page, /InternalChinaDraftInlineQuantityBridge/);
  assert.doesNotMatch(page, /InternalChinaDraftQuantityEditor/);
  assert.match(page, /모든 B-code 행의 수량 칸에서 직접 변경/);
  assert.match(page, /표 자체에 포함/);
});

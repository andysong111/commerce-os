import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  "src/app/china-order-manager/drafts/[draftId]/page.tsx",
  "utf8",
);
const stickySave = await readFile(
  "src/components/china-order-manager/InternalChinaDraftStickySave.tsx",
  "utf8",
);
const workspace = await readFile(
  "src/components/china-order-manager/InternalChinaPurchaseDraftWorkspaceV2.tsx",
  "utf8",
);

test("China draft page exposes an always-visible save shortcut", () => {
  assert.match(page, /InternalChinaDraftStickySave/);
  assert.match(page, /<InternalChinaDraftStickySave status=\{draft\.status\}/);
  assert.match(stickySave, /fixed bottom-24 right-5/);
  assert.match(stickySave, /입력값 저장/);
  assert.match(stickySave, /Ctrl\+S로도 저장/);
});

test("floating shortcut reuses the native bidirectional draft save action", () => {
  assert.match(stickySave, /발주초안 저장/);
  assert.match(stickySave, /target\.click\(\)/);
  assert.match(workspace, /purchase-metadata/);
  assert.match(workspace, /상품출시진행관리와 상품마스터 최신 원장에 양방향 반영/);
});

test("floating shortcut never records or places an external order", () => {
  assert.doesNotMatch(stickySave, /MARK_ORDERED|1688 주문완료 후 기록|placeOrder|payOrder|checkout/);
});

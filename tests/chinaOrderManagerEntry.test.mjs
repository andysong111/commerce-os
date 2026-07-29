import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const registry = await readFile("src/lib/moduleRegistry.ts", "utf8");
const launcher = await readFile(
  "src/app/china-order-manager/page.tsx",
  "utf8",
);

test("dashboard and sidebar expose the completed China order manager", () => {
  assert.match(registry, /title: "중국 발주·입고 관리"/);
  assert.match(registry, /navigationLabel: "중국 발주·입고 관리"/);
  assert.match(registry, /route: "\/china-order-manager"/);
  assert.match(registry, /발주차시 저장부터 입고·누락 확정까지 처리합니다/);
  assert.match(registry, /actionLabel: "발주·입고 관리 열기"/);
  assert.match(registry, /safetyBadge: "외부 재고 미변경"/);
});

test("entry route opens the deployed order manager without external writes", () => {
  assert.match(
    launcher,
    /https:\/\/china-order-manager\.andy123df23\.chatgpt\.site/,
  );
  assert.match(launcher, /redirect\(CHINA_ORDER_MANAGER_URL\)/);
  assert.doesNotMatch(launcher, /fetch\(|supabase|shopling/i);
});

test("registry keeps product master and inventory integrations out of this module", () => {
  assert.match(
    registry,
    /상품마스터·실재고·샵플링 재고는 아직 연결하지 않습니다/,
  );
});

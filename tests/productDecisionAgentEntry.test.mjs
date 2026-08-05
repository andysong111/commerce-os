import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const registry = await readFile("src/lib/extendedModuleRegistry.ts", "utf8");
const workspace = await readFile("src/lib/opsWorkspace.ts", "utf8");

test("product decision agent is available inside Ops Center as read-only purchase recommendations", () => {
  assert.match(registry, /id: "product-decision-agent"/);
  assert.match(registry, /title: "발주 추천"/);
  assert.doesNotMatch(registry, /title: "발주·단종 추천"/);
  assert.match(registry, /status: "available"/);
  assert.match(registry, /route: "\/product-decision-agent"/);
  assert.match(registry, /externalProject: false/);
  assert.doesNotMatch(
    registry,
    /route: "https:\/\/commerce-os-product-decision-agent\.andy123df23\.chatgpt\.site"/,
  );
  assert.match(registry, /helperNote: "Ops Center 내부 · 조회 전용"/);
  assert.match(registry, /safetyBadge: "이전 1단계 · 쓰기 차단"/);
  assert.match(registry, /승인·중국 주문 전송·실제 주문은 차단/);
});

test("product decision agent is grouped under sourcing and ordering", () => {
  assert.match(
    workspace,
    /"sourcing-engine", "product-decision-agent", "china-order-cost"/,
  );
});

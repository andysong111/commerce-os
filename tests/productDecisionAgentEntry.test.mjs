import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const registry = await readFile("src/lib/extendedModuleRegistry.ts", "utf8");
const workspace = await readFile("src/lib/opsWorkspace.ts", "utf8");

test("product decision agent is available as purchase recommendations", () => {
  assert.match(registry, /id: "product-decision-agent"/);
  assert.match(registry, /title: "발주 추천"/);
  assert.doesNotMatch(registry, /title: "발주·단종 추천"/);
  assert.match(registry, /status: "available"/);
  assert.match(
    registry,
    /https:\/\/commerce-os-product-decision-agent\.andy123df23\.chatgpt\.site/,
  );
  assert.match(registry, /safetyBadge: "실제 주문·결제 별도"/);
  assert.match(registry, /단종과 상품등급 판단은 상품등급·가격조정에서 담당/);
});

test("product decision agent is grouped under sourcing and ordering", () => {
  assert.match(
    workspace,
    /"sourcing-engine", "product-decision-agent", "china-order-cost"/,
  );
});

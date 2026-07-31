import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const registry = await readFile("src/lib/extendedModuleRegistry.ts", "utf8");
const workspace = await readFile("src/lib/opsWorkspace.ts", "utf8");

test("product decision agent is available from the dashboard registry", () => {
  assert.match(registry, /id: "product-decision-agent"/);
  assert.match(registry, /title: "발주·단종 추천"/);
  assert.match(registry, /status: "available"/);
  assert.match(
    registry,
    /https:\/\/commerce-os-product-decision-agent\.andy123df23\.chatgpt\.site/,
  );
  assert.match(registry, /safetyBadge: "재고 차감 전"/);
});

test("product decision agent is grouped under sourcing and ordering", () => {
  assert.match(
    workspace,
    /"sourcing-engine", "product-decision-agent", "china-order-cost"/,
  );
});

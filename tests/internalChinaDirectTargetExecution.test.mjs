import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [policy, execution, route, button, page] = await Promise.all([
  readFile("src/lib/internalChinaGroupCostPricePolicy.ts", "utf8"),
  readFile("src/lib/internalChinaGroupCostPriceExecution.ts", "utf8"),
  readFile("src/app/api/china-order-manager/price-review/group-aware-execute/route.ts", "utf8"),
  readFile("src/components/china-order-manager/InternalChinaGroupCostPriceExecutionButton.tsx", "utf8"),
  readFile("src/app/china-order-manager/price-review/page.tsx", "utf8"),
]);

test("confirmed-cost increase policy uses the full target with no percentage cap", () => {
  assert.ok(policy.includes('if (currentPrice < targetPrice)'));
  assert.ok(policy.includes('direction: "INCREASE"'));
  assert.ok(policy.includes('changeRequired: true'));
  assert.equal(policy.includes("MAX_INCREASE"), false);
  assert.equal(policy.includes("maxIncrease"), false);
});

test("direct execution carries the exact target sell price instead of a staged intermediate", () => {
  assert.ok(execution.includes('"CONFIRMED_COST_DIRECT_TARGET_NO_CAP_V1"'));
  assert.ok(execution.includes("targetSellPrice: validated.targetSellPrice"));
  assert.ok(execution.includes("target_sell_price: row.targetSellPrice"));
  assert.equal(execution.includes("stagedTarget"), false);
  assert.equal(execution.includes("cappedTarget"), false);
});

test("execution is scoped to resolved live approved rows and connected malls", () => {
  assert.ok(execution.includes('row.saleStatusActive === true'));
  assert.ok(execution.includes('row.productGroupSource !== "UNRESOLVED"'));
  assert.ok(execution.includes("buildInternalMallPriceTargets"));
  assert.ok(execution.includes("INTERNAL_CHINA_DIRECT_TARGET_MALL_SCOPE_MISMATCH"));
  assert.ok(execution.includes("INTERNAL_CHINA_DIRECT_TARGET_APPROVAL_REQUIRED"));
});

test("goods_key duplicates must agree on group target and mall targets before dispatch", () => {
  assert.ok(execution.includes("INTERNAL_CHINA_DIRECT_TARGET_GOODSKEY_CONFLICT"));
  assert.ok(execution.includes("existing.targetSellPrice !== next.targetSellPrice"));
  assert.ok(execution.includes("JSON.stringify(existing.mallTargets) !== JSON.stringify(next.mallTargets)"));
});

test("workflow dispatch is idempotent by proposal and batch and fails closed on uncertain state", () => {
  assert.ok(execution.includes('"shopling-explicit-price-plan.yml"'));
  assert.ok(execution.includes("INTERNAL_CHINA_DIRECT_TARGET_BATCH_SIZE = 20"));
  assert.ok(execution.includes('status === "SUCCEEDED"'));
  assert.ok(execution.includes('status === "RUNNING"'));
  assert.ok(execution.includes("INTERNAL_CHINA_DIRECT_TARGET_BATCH_STATE_UNCERTAIN"));
  assert.ok(execution.includes("loadInternalChinaDirectTargetExecution(proposal.fingerprint)"));
});

test("same-origin route and UI preserve the explicit high-increase confirmation", () => {
  assert.ok(route.includes("isSameOriginOpsRequest"));
  assert.ok(button.includes("인상률 상한은 두지 않습니다"));
  assert.ok(button.includes("단계 인상 없이 최종가로 한 번에 이동"));
  assert.ok(page.includes("인상률 상한 없음 · 단계 인상 없음"));
  assert.ok(page.includes("InternalChinaGroupCostPriceExecutionButton"));
});

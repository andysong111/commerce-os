import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  allocatePurchasePortfolio,
  calculateProductOrderBudget,
} from "../src/lib/productDecisionEngine/portfolio.ts";

const items = [
  {
    barcode: "BAA1-1",
    group: "발주 추천",
    netRequiredQuantity: 60,
    unitCost: 1_000,
    totalScore: 100,
    moq: 1,
    cartonQuantity: 1,
  },
  {
    barcode: "BAA1-2",
    group: "발주 추천",
    netRequiredQuantity: 60,
    unitCost: 1_000,
    totalScore: 80,
    moq: 1,
    cartonQuantity: 1,
  },
  {
    barcode: "BAA1-3",
    group: "소량 검토",
    netRequiredQuantity: 40,
    unitCost: 1_000,
    totalScore: 999,
    moq: 1,
    cartonQuantity: 1,
  },
];

test("explicit cash envelope overrides only the gross funding cap", () => {
  const result = allocatePurchasePortfolio({
    recent30DayRevenue: 9_000_000,
    grossBudgetOverrideKrw: 145_000,
    purchaseCostMultiplier: 1.45,
    minimumOrderAmount: 0,
    items,
  });
  assert.equal(result.grossBudget, 145_000);
  assert.equal(result.productOrderBudget, 100_000);
  assert.equal(result.expectedSpend, 100_000);
  assert.deepEqual(
    result.items.map((row) => [row.barcode, row.allocatedQuantity]),
    [
      ["BAA1-1", 60],
      ["BAA1-2", 40],
      ["BAA1-3", 0],
    ],
  );
});

test("cash envelope preserves existing group priority before score", () => {
  const result = allocatePurchasePortfolio({
    recent30DayRevenue: 9_000_000,
    grossBudgetOverrideKrw: 87_000,
    purchaseCostMultiplier: 1.45,
    minimumOrderAmount: 0,
    items,
  });
  assert.equal(result.productOrderBudget, 60_000);
  assert.equal(result.items[0].allocatedQuantity, 60);
  assert.equal(result.items[1].allocatedQuantity, 0);
  assert.equal(result.items[2].allocatedQuantity, 0);
});

test("omitting cash envelope keeps the original revenue based budget", () => {
  const result = allocatePurchasePortfolio({
    recent30DayRevenue: 290_000,
    purchaseCostMultiplier: 1.45,
    minimumOrderAmount: 0,
    items: [],
  });
  assert.equal(result.grossBudget, 145_000);
  assert.equal(result.productOrderBudget, calculateProductOrderBudget(145_000, 1.45));
});

test("cash envelope UI is calculation-only and reachable from China purchase workspace", async () => {
  const layout = await readFile("src/app/china-order-manager/layout.tsx", "utf8");
  const page = await readFile(
    "src/app/china-order-manager/cash-envelope/page.tsx",
    "utf8",
  );
  const panel = await readFile(
    "src/components/china-order-manager/InternalChinaCashEnvelopePanel.tsx",
    "utf8",
  );
  const route = await readFile(
    "src/app/api/fast-purchase/cash-envelope/route.ts",
    "utf8",
  );
  assert.match(layout, /ChinaOrderManagerNav/);
  assert.match(page, /현금 제약 발주/);
  assert.match(panel, /현금 기준 발주 권장안 계산/);
  assert.match(panel, /내부 Draft·1688 주문·결제는 생성되지 않습니다/);
  assert.match(route, /isSameOriginOpsRequest/);
  assert.doesNotMatch(route, /method:\s*["'](?:PUT|PATCH|DELETE)["']/i);
});

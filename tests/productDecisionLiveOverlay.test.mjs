import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const { applyProductDecisionLiveOverlay } = await importTranspiledTypeScript(
  new URL("../src/lib/productDecisionLiveOverlay.ts", import.meta.url),
);

function snapshot() {
  return {
    mode: "LIVE",
    generatedAt: "2026-08-04T09:45:20.591Z",
    expectedSpend: 100_000,
    products: [
      {
        barcode: "BAA1-1",
        name: "상품 A",
        rawRecommendedQty: 100,
        recommendedQty: 120,
        expectedCost: 60_000,
        estimatedStock: 10,
        openCommitment: 0,
        securedQuantity: 10,
        netRequiredRaw: 90,
        inventoryKnown: true,
      },
      {
        barcode: "BAA1-2",
        name: "상품 B",
        rawRecommendedQty: 50,
        recommendedQty: 50,
        expectedCost: 40_000,
        inventoryKnown: false,
      },
    ],
  };
}

test("confirmed inventory and China open orders update only secured and net-required fields", () => {
  const result = applyProductDecisionLiveOverlay(
    snapshot(),
    [
      {
        barcode: "BAA1-1",
        estimatedQuantity: 40,
        confirmed: true,
      },
      {
        barcode: "BAA1-2",
        estimatedQuantity: 70,
        confirmed: true,
      },
    ],
    new Map([
      ["BAA1-1", 20],
      ["BAA1-2", 5],
    ]),
    { inventoryGeneratedAt: "2026-08-05T10:00:00.000Z" },
  );

  const first = result.snapshot.products[0];
  const second = result.snapshot.products[1];
  assert.equal(first.estimatedStock, 40);
  assert.equal(first.openCommitment, 20);
  assert.equal(first.securedQuantity, 60);
  assert.equal(first.netRequiredRaw, 40);
  assert.equal(first.recommendedQty, 120);
  assert.equal(first.expectedCost, 60_000);
  assert.equal(second.netRequiredRaw, 0);
  assert.equal(second.recommendedQty, 50);
  assert.equal(result.summary.zeroNeedCount, 1);
  assert.equal(result.summary.changedProductCount, 2);
  assert.equal(result.summary.confirmedInventoryCount, 2);
  assert.equal(result.summary.commitmentBarcodeCount, 2);
});

test("unconfirmed or review inventory is not silently subtracted", () => {
  const result = applyProductDecisionLiveOverlay(
    snapshot(),
    [
      {
        barcode: "BAA1-1",
        estimatedQuantity: 999,
        confirmed: true,
        requiresReview: true,
      },
    ],
    new Map([["BAA1-1", 10]]),
  );
  const row = result.snapshot.products[0];
  assert.equal(row.inventoryKnown, false);
  assert.equal(row.estimatedStock, 0);
  assert.equal(row.openCommitment, 10);
  assert.equal(row.netRequiredRaw, 90);
});

test("overlay normalizes barcode identity and clamps quantities at zero", () => {
  const result = applyProductDecisionLiveOverlay(
    snapshot(),
    [
      {
        barcode: " baa1–1 ",
        estimatedQuantity: 200,
        confirmed: true,
      },
    ],
    new Map([["BAA1-1", -50]]),
  );
  const row = result.snapshot.products[0];
  assert.equal(row.barcode, "BAA1-1");
  assert.equal(row.estimatedStock, 200);
  assert.equal(row.openCommitment, 0);
  assert.equal(row.netRequiredRaw, 0);
});

test("integration reads product master inventory and China commitments without external writes", async () => {
  const integration = await readFile(
    "src/lib/integrations/productDecisionAgent.ts",
    "utf8",
  );
  const page = await readFile(
    "src/app/product-decision-agent/page.tsx",
    "utf8",
  );
  assert.match(integration, /inventory-snapshot/);
  assert.match(integration, /openChinaOrderCommitmentsByBarcode/);
  assert.match(integration, /internal_live_overlay/);
  assert.match(page, /라이브 재고·미입고 오버레이 연결/);
  assert.match(page, /권장주문\(기준\)/);
  assert.match(page, /실제 주문 쓰기 차단/);
  assert.doesNotMatch(integration, /method:\s*"POST"/);
  assert.doesNotMatch(integration, /method:\s*"PUT"/);
  assert.doesNotMatch(integration, /method:\s*"DELETE"/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildExactInventory } from "../src/lib/inventoryLifecycleLedger.ts";

const RESET_AT = "2026-09-01T00:00:00.000Z";
const AS_OF = "2026-09-30T00:00:00.000Z";

function reset(overrides = {}) {
  return {
    barcode: "BAA1-1",
    modelNo: "AAA001",
    productName: "테스트 상품",
    productMode: "OPTION",
    reason: "창고 실물 품절 확인",
    occurredAt: RESET_AT,
    sourceEventId: "inventory-stockout-reset:BAA1-1:test",
    ...overrides,
  };
}

test("stockout reset starts at zero and counts only post-reset receipt deltas and valid sales", () => {
  const result = buildExactInventory({
    reset: reset(),
    receipts: [
      {
        barcode: "BAA1-1",
        occurredAt: "2026-09-05T00:00:00.000Z",
        quantity: 100,
        sourceLineId: "line-1",
      },
      {
        barcode: "BAA1-1",
        occurredAt: "2026-09-20T00:00:00.000Z",
        quantity: 50,
        sourceLineId: "line-2",
      },
      {
        barcode: "BAA9-9",
        occurredAt: "2026-09-10T00:00:00.000Z",
        quantity: 999,
        sourceLineId: "other-barcode",
      },
      {
        barcode: "BAA1-1",
        occurredAt: "2026-08-20T00:00:00.000Z",
        quantity: 300,
        sourceLineId: "before-reset",
      },
    ],
    sales: [
      { occurredAt: "2026-09-10T00:00:00.000Z", quantity: 23 },
      { occurredAt: "2026-08-25T00:00:00.000Z", quantity: 200 },
    ],
    analysisAsOf: AS_OF,
  });

  assert.equal(result.inboundAfterReset, 150);
  assert.equal(result.salesAfterReset, 23);
  assert.equal(result.currentQuantity, 127);
  assert.deepEqual(result.stockoutIntervals, [
    {
      startAt: RESET_AT,
      endAt: "2026-09-05T00:00:00.000Z",
    },
  ]);
});

test("sales never drive exact inventory below zero and a later receipt reopens selling inventory", () => {
  const result = buildExactInventory({
    reset: reset(),
    receipts: [
      {
        barcode: "BAA1-1",
        occurredAt: "2026-09-03T00:00:00.000Z",
        quantity: 10,
        sourceLineId: "line-1",
      },
      {
        barcode: "BAA1-1",
        occurredAt: "2026-09-15T00:00:00.000Z",
        quantity: 7,
        sourceLineId: "line-2",
      },
    ],
    sales: [
      { occurredAt: "2026-09-05T00:00:00.000Z", quantity: 15 },
    ],
    analysisAsOf: AS_OF,
  });

  assert.equal(result.currentQuantity, 7);
  assert.equal(result.inboundAfterReset, 17);
  assert.equal(result.salesAfterReset, 15);
  assert.deepEqual(result.stockoutIntervals, [
    {
      startAt: RESET_AT,
      endAt: "2026-09-03T00:00:00.000Z",
    },
    {
      startAt: "2026-09-05T00:00:00.000Z",
      endAt: "2026-09-15T00:00:00.000Z",
    },
  ]);
});

test("an unresolved stockout interval reduces available days for demand recovery", () => {
  const result = buildExactInventory({
    reset: reset({ occurredAt: "2026-09-20T00:00:00.000Z" }),
    receipts: [],
    sales: [],
    analysisAsOf: "2026-09-30T00:00:00.000Z",
  });

  assert.equal(result.currentQuantity, 0);
  assert.equal(result.stockoutIntervals.length, 1);
  assert.equal(result.availableDaysByBucket[0], 20);
  assert.equal(result.availableDaysByBucket[1], 30);
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildReceiptLivePriceProposal } from "../src/lib/receiptLivePriceProposal.ts";

function event() {
  return {
    eventId: "11111111-1111-4111-8111-111111111111",
    receiptId: "22222222-2222-4222-8222-222222222222",
    batchId: 77,
    occurredAt: "2026-08-09T03:00:00.000Z",
    barcodes: ["BGG1-1"],
    totals: { good: 10, damaged: 0, missing: 0 },
  };
}

function source() {
  return {
    batchId: 77,
    sourceMode: "legacy_confirmed_batch",
    syncedAt: "2026-08-09T03:01:00.000Z",
    pageCount: 1,
    sourceWritesEnabled: false,
    rows: [
      {
        id: "legacy-confirmed-item:77:1",
        receiptId: "legacy-confirmed-batch:77",
        batchId: 77,
        orderItemId: 1,
        barcode: "BGG1-1",
        modelNumber: "aaa316",
        optionName: "단품",
        quantity: 10,
        unitCostKrw: 100,
        receivedAt: "2026-08-09T03:00:00.000Z",
      },
    ],
  };
}

function priceInput() {
  return {
    skuId: "sku-bgg1-1",
    barcode: "BGG1-1",
    modelNo: "aaa316",
    productName: "계란펀칭기",
    optionName: "단품",
    currentPrice: 9999,
    currentGrade: 0,
    launchedAt: "2025-01-01T00:00:00.000Z",
    lastSaleAt: "2026-08-08T00:00:00.000Z",
    monthlyUnits: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
    receipts: [],
    discontinued: false,
    active: true,
    markdownStage: 0,
    latestInputAt: "2026-08-09T03:00:00.000Z",
    existingLifecycle: null,
  };
}

function planning(extraOwner = false) {
  const rows = [
    {
      skuId: "sku-bgg1-1",
      barcode: "BGG1-1",
      productName: "계란펀칭기",
      skuActive: true,
      listings: [
        {
          goodsKey: "121111",
          optionId: "1",
          unitsPerOrder: 1,
          active: true,
        },
      ],
    },
  ];
  if (extraOwner) {
    rows.push({
      skuId: "sku-other",
      barcode: "BGE1-1",
      productName: "다른 상품",
      skuActive: true,
      listings: [
        {
          goodsKey: "121111",
          optionId: "2",
          unitsPerOrder: 1,
          active: true,
        },
      ],
    });
  }
  return rows;
}

function live() {
  return {
    generatedAt: "2026-08-09T03:02:00.000Z",
    state: "READY",
    productCount: 1,
    readyCount: 1,
    missingCount: 0,
    conflictCount: 0,
    queriedGoodsKeyCount: 1,
    sourceRowCount: 1,
    writesEnabled: false,
    rows: [
      {
        barcode: "BGG1-1",
        state: "READY",
        priceMode: "UNIFORM",
        currentSalePrice: 100,
        goodsKeys: ["121111"],
        mappedListingCount: 1,
        unresolvedListingCount: 0,
        conflictListingCount: 0,
        distinctPrices: [100],
        listings: [
          {
            goodsKey: "121111",
            optionId: "1",
            ptnGoodsCd: "aaa316a",
            productGroup: "도매1",
            baseSalePrice: 100,
            optionAmount: 0,
            effectiveSalePrice: 100,
            originalCost: 50,
            listPrice: 150,
            saleStatus: "판매중",
          },
        ],
      },
    ],
  };
}

test("proposal ignores stale PM price and calculates from exact batch cost plus live Shopling price", () => {
  const proposal = buildReceiptLivePriceProposal({
    event: event(),
    receiptSource: source(),
    priceInputs: [priceInput()],
    planningProducts: planning(false),
    livePrices: live(),
    generatedAt: "2026-08-09T03:03:00.000Z",
  });
  const row = proposal.listingProposals[0];
  assert.equal(row.currentEffectiveSalePrice, 100);
  assert.equal(row.latestBatchUnitCostKrw, 100);
  assert.equal(row.latestBatchQuantity, 10);
  assert.ok(row.targetEffectiveSalePrice >= 200);
  assert.equal(row.priceChangeRequired, true);
  assert.ok(row.adjustmentBps > 0);
  assert.equal(proposal.goodsKeyProposals[0].canaryEligible, true);
  assert.equal(proposal.writesEnabled, false);
});

test("a goods_key shared with an unaffected B-code is blocked from canary", () => {
  const proposal = buildReceiptLivePriceProposal({
    event: event(),
    receiptSource: source(),
    priceInputs: [priceInput()],
    planningProducts: planning(true),
    livePrices: live(),
    generatedAt: "2026-08-09T03:03:00.000Z",
  });
  const goodsKey = proposal.goodsKeyProposals[0];
  assert.equal(goodsKey.canaryEligible, false);
  assert.match(goodsKey.blockedReason || "", /GOODS_KEY_SHARED_WITH_UNAFFECTED/);
});

test("receipt source cannot introduce a barcode outside the confirmed event", () => {
  const badSource = source();
  badSource.rows[0].barcode = "BGE1-1";
  assert.throws(
    () =>
      buildReceiptLivePriceProposal({
        event: event(),
        receiptSource: badSource,
        priceInputs: [priceInput()],
        planningProducts: planning(false),
        livePrices: live(),
      }),
    /RECEIPT_PROPOSAL_FOREIGN_BARCODE/,
  );
});

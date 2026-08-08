import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateProductMasterShoplingSalesChunk,
} from "../src/lib/productMasterShoplingSalesBackfillEngine.ts";
import {
  aggregateProductMasterShoplingSalesEventChunk,
  combineProductMasterShoplingSalesEventChunks,
  PRODUCT_MASTER_SALES_EVENT_FORMAT,
  PRODUCT_MASTER_SALES_EVENT_SOURCE,
} from "../src/lib/productMasterShoplingSalesEventEngine.ts";

const planning = {
  generatedAt: "2026-08-08T00:00:00.000Z",
  products: [
    {
      skuId: "sku:BAA1-1",
      barcode: "BAA1-1",
      productName: "current",
      skuActive: true,
      listings: [
        { optionId: "opt-current", goodsKey: "goods-a", unitsPerOrder: 2, active: true },
      ],
    },
    {
      skuId: "sku:BBB1-1",
      barcode: "BBB1-1",
      productName: "historical",
      skuActive: false,
      listings: [
        { optionId: "opt-old", goodsKey: "goods-old", unitsPerOrder: 1, active: false },
      ],
    },
  ],
};

const range = { start: "2026-07-01", end: "2026-07-31" };

function row({ orderNo, optionId, barcode, status = "배송완료", quantity = 1, unitPrice = 1000, date = "20260710120000", seq = "1", goodsKey = "goods-a" }) {
  return {
    ord_no: orderNo,
    opt_id: optionId,
    optBarcode: barcode,
    ord_status: status,
    mall_ord_cnt: quantity,
    mall_unit_price: unitPrice,
    mall_ord_dt: date,
    mall_ord_seq: seq,
    prod_id: goodsKey,
  };
}

test("event ledger preserves monthly totals for valid managed sales", () => {
  const rows = [
    row({ orderNo: "A1", optionId: "opt-current", barcode: "BAA1-1", quantity: 2, unitPrice: 1500 }),
    row({ orderNo: "A2", optionId: "opt-current", barcode: "BAA1-1", quantity: 1, unitPrice: 2000, date: "20260721123000" }),
  ];
  const monthly = aggregateProductMasterShoplingSalesChunk(rows, planning, range);
  const events = aggregateProductMasterShoplingSalesEventChunk(
    rows,
    planning,
    range,
    "2026-08-08T00:00:00.000Z",
  );
  assert.equal(events.unmappedRows, 0);
  assert.equal(events.tombstoneRows, 0);
  assert.equal(events.totalBaseUnits, monthly.totalBaseUnits);
  assert.equal(events.totalRevenue, monthly.totalRevenue);
});

test("cancelled managed order lines become tombstones instead of stale demand", () => {
  const events = aggregateProductMasterShoplingSalesEventChunk(
    [row({ orderNo: "C1", optionId: "opt-current", barcode: "BAA1-1", status: "주문취소", quantity: 3 })],
    planning,
    range,
    "2026-08-08T00:00:00.000Z",
  );
  assert.equal(events.eventRows, 1);
  assert.equal(events.validRows, 0);
  assert.equal(events.tombstoneRows, 1);
  assert.equal(events.events[0].validSale, false);
});

test("exact historical option barcode remains stronger than a later current option identity", () => {
  const events = aggregateProductMasterShoplingSalesEventChunk(
    [row({ orderNo: "H1", optionId: "opt-current", barcode: "BBB1-1", goodsKey: "goods-old" })],
    planning,
    range,
    "2026-08-08T00:00:00.000Z",
  );
  assert.equal(events.unmappedRows, 0);
  assert.equal(events.events[0].barcode, "BBB1-1");
});

test("cross-chunk external identity conflicts fail visibly in the combine result", () => {
  const first = aggregateProductMasterShoplingSalesEventChunk(
    [row({ orderNo: "D1", optionId: "opt-current", barcode: "BAA1-1" })],
    planning,
    range,
    "2026-08-08T00:00:00.000Z",
  );
  const second = structuredClone(first);
  second.events[0].barcode = "BBB1-1";
  const combined = combineProductMasterShoplingSalesEventChunks([first, second]);
  assert.deepEqual(combined.conflictExternalIds, [first.events[0].externalId]);
});

test("wire contract is pinned to Product Master canonical sales event API", () => {
  assert.equal(PRODUCT_MASTER_SALES_EVENT_FORMAT, "commerce-os-sales-events-v1");
  assert.equal(PRODUCT_MASTER_SALES_EVENT_SOURCE, "shopling_orders_event_v1");
});

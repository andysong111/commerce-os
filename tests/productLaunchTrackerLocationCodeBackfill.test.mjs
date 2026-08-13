import assert from "node:assert/strict";
import test from "node:test";
import { prepareProductLaunchLocationCodeBackfill } from "../src/lib/productLaunchTrackerLocationCodeBackfill.ts";

const state = {
  schemaVersion: 3,
  items: [{
    id: "item-1",
    modelNumber: "AAA001",
    productName: "테스트 상품",
    barcode: "BAA1-2",
    warehouseLocation: "BAA1-2",
    orderOptions: [
      { id: "option-1", saleOption: "블랙", barcode: "" },
      { id: "option-2", saleOption: "화이트", barcode: "" },
    ],
  }],
};
const mapping = [{
  itemId: "item-1",
  expectedModelNumber: "AAA001",
  expectedProductName: "테스트 상품",
  orderOptions: [
    { optionId: "option-1", expectedSaleOption: "블랙", barcode: "BAA1-1" },
    { optionId: "option-2", expectedSaleOption: "화이트", barcode: "BAA1-2" },
  ],
}];

test("fills every option and normalizes representative B code", () => {
  const result = prepareProductLaunchLocationCodeBackfill(state, mapping);
  assert.equal(result.report.hardConflictCount, 0);
  assert.equal(result.state.items[0].barcode, "BAA1-1");
  assert.equal(result.state.items[0].warehouseLocation, "BAA1-1");
  assert.deepEqual(result.state.items[0].orderOptions.map((row) => row.barcode), ["BAA1-1", "BAA1-2"]);
});

test("a conflicting existing option B code prevents an overwrite", () => {
  const conflictState = structuredClone(state);
  conflictState.items[0].orderOptions[0].barcode = "BAA9-9";
  const result = prepareProductLaunchLocationCodeBackfill(conflictState, mapping);
  assert.equal(result.report.hardConflictCount, 1);
  assert.equal(result.report.optionConflicts[0].reason, "existing_b_code_conflict");
  assert.equal(result.state.items[0].orderOptions[1].barcode, "");
});

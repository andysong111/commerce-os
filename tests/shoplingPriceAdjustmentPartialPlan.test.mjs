import assert from "node:assert/strict";
import test from "node:test";
import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const partialPlan = await importTranspiledTypeScript(
  new URL("../src/lib/shoplingPriceAdjustmentPartialPlan.ts", import.meta.url),
);
const sig = "a".repeat(64);

function planned(goodsKey, adjustmentBps) {
  return {
    goods_key: goodsKey,
    adjustment_bps: adjustmentBps,
    current: {
      sell_price: 10000,
      option_amounts: [0, 1000],
      option_signature: sig,
    },
    target: {
      sell_price: 11000,
      option_amounts: [0, 1100],
    },
  };
}

test("keeps valid rows and isolates read-only plan errors", () => {
  const result = partialPlan.buildPartialExecutionPlan({
    status: "partial_failure",
    rows: [planned("100", 1000), planned("102", 1000)],
    errors: [{ goods_key: "101", error: "sale_price is missing" }],
  }, [
    { goods_key: "100", adjustment_bps: 1000 },
    { goods_key: "101", adjustment_bps: 1000 },
    { goods_key: "102", adjustment_bps: 1000 },
  ]);

  assert.deepEqual(result.validInputs.map((row) => row.goods_key), ["100", "102"]);
  assert.deepEqual(result.rejectedRows, [{
    goods_key: "101",
    adjustment_bps: 1000,
    error: "sale_price is missing",
  }]);
  assert.equal(result.executionRows.length, 2);
  assert.equal(result.executionRows[0].requires_option_write, true);
});

test("accepts sparse Shopling option matrices and detects active amount changes", () => {
  const result = partialPlan.buildPartialExecutionPlan({
    status: "success",
    rows: [{
      goods_key: "112969",
      adjustment_bps: 1000,
      current: {
        sell_price: 10000,
        option_amounts: [0, null, null, null, 390, null, null, null, 390],
        option_signature: sig,
      },
      target: {
        sell_price: 11000,
        option_amounts: [0, null, null, null, 430, null, null, null, 430],
      },
    }],
    errors: [],
  }, [{ goods_key: "112969", adjustment_bps: 1000 }]);

  assert.equal(result.rejectedRows.length, 0);
  assert.equal(result.executionRows.length, 1);
  assert.equal(result.executionRows[0].requires_option_write, true);
});

test("rejects invalid sparse option cells instead of treating them as blanks", () => {
  assert.throws(() => partialPlan.buildPartialExecutionPlan({
    status: "success",
    rows: [{
      goods_key: "112969",
      adjustment_bps: 1000,
      current: {
        sell_price: 10000,
        option_amounts: [0, "", 390],
        option_signature: sig,
      },
      target: {
        sell_price: 11000,
        option_amounts: [0, null, 430],
      },
    }],
    errors: [],
  }, [{ goods_key: "112969", adjustment_bps: 1000 }]), /option amount array is invalid/);
});

test("rejects summaries that omit an expected goods_key", () => {
  assert.throws(() => partialPlan.buildPartialExecutionPlan({
    status: "partial_failure",
    rows: [planned("100", 1000)],
    errors: [],
  }, [
    { goods_key: "100", adjustment_bps: 1000 },
    { goods_key: "101", adjustment_bps: 1000 },
  ]), /missing goods_key 101/);
});

test("does not continue when every row is rejected", () => {
  assert.throws(() => partialPlan.buildPartialExecutionPlan({
    status: "partial_failure",
    rows: [],
    errors: [{ goods_key: "100", error: "missing" }],
  }, [{ goods_key: "100", adjustment_bps: 1000 }]), /rejected every row/);
});

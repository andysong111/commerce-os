import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const card5Page = readFileSync("src/app/warehouse-location-sync/page.tsx", "utf8");
const card13Page = readFileSync("src/app/product-launch-flow/page.tsx", "utf8");
const card14Page = readFileSync("src/app/shopling-product-upload-runner/page.tsx", "utf8");
const card13Runner = readFileSync("src/components/product-launch-flow/ProductLaunchFlow.tsx", "utf8");
const card14Runner = readFileSync("src/components/shopling-product-upload-runner/ShoplingProductUploadRunner.tsx", "utf8");


test("cards 5, 13, and 14 expose the same location-code barcode policy", () => {
  for (const source of [card5Page, card13Page, card14Page]) {
    assert.ok(source.includes("옵션자체관리코드"));
    assert.ok(source.includes("바코드"));
    assert.ok(source.includes("동일"));
  }
});

test("cards 13 and 14 keep using the shared Shopling upload runner", () => {
  const endpoint = "/api/shopling-product-upload/run";
  assert.ok(card13Runner.includes(endpoint));
  assert.ok(card14Runner.includes(endpoint));
});

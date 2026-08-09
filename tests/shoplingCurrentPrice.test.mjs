import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildShoplingProductIdLookupXml,
  resolveShoplingCurrentPrices,
} from "../src/lib/shopling/shoplingCurrentPriceResolver.ts";

const source = await readFile(
  "src/lib/shopling/shoplingCurrentPrice.ts",
  "utf8",
);

test("current price lookup uses explicit Shopling product IDs instead of a recent modified-date window", () => {
  const xml = buildShoplingProductIdLookupXml(
    { loginId: "login", companyId: "company", authKey: "secret" },
    ["121111", "121112"],
    "goods_key,org_price,sale_price,list_price",
  );
  assert.match(xml, /<prod_id><!\[CDATA\[121111,121112\]\]><\/prod_id>/);
  assert.match(xml, /sale_price/);
  assert.match(xml, /org_price/);
  assert.match(xml, /<opt_yn>Y<\/opt_yn>/);
  assert.doesNotMatch(xml, /start_dt|end_dt|search_tp/);
});

test("effective current sale price includes the exact option additional amount", () => {
  const snapshot = resolveShoplingCurrentPrices(
    [
      {
        barcode: "BGG1-1",
        listings: [{ goodsKey: "121111", optionId: "987", active: true }],
      },
    ],
    [
      {
        goods_key: "121111",
        ptn_goods_cd: "aaa316a",
        sale_price: "3000",
        optId: "987",
        optAmt: "500",
      },
    ],
    "2026-08-09T00:00:00.000Z",
  );
  assert.equal(snapshot.rows[0].state, "READY");
  assert.equal(snapshot.rows[0].priceMode, "UNIFORM");
  assert.equal(snapshot.rows[0].currentSalePrice, 3500);
  assert.equal(snapshot.rows[0].listings[0].productGroup, "도매1");
});

test("different Shopling product-group prices are preserved instead of collapsed", () => {
  const snapshot = resolveShoplingCurrentPrices(
    [
      {
        barcode: "BGG1-1",
        listings: [
          { goodsKey: "121111", optionId: "1", active: true },
          { goodsKey: "121112", optionId: "2", active: true },
        ],
      },
    ],
    [
      { goods_key: "121111", ptn_goods_cd: "aaa316a", sale_price: "3000", optId: "1", optAmt: "0" },
      { goods_key: "121112", ptn_goods_cd: "aaa316e", sale_price: "3200", optId: "2", optAmt: "0" },
    ],
  );
  assert.equal(snapshot.rows[0].state, "READY");
  assert.equal(snapshot.rows[0].priceMode, "GROUPED");
  assert.equal(snapshot.rows[0].currentSalePrice, 0);
  assert.deepEqual(snapshot.rows[0].distinctPrices, [3000, 3200]);
  assert.deepEqual(
    snapshot.rows[0].listings.map((row) => [row.productGroup, row.effectiveSalePrice]),
    [["도매1", 3000], ["소매1", 3200]],
  );
});

test("ambiguous price for one exact listing fails closed", () => {
  const snapshot = resolveShoplingCurrentPrices(
    [
      {
        barcode: "BGG1-1",
        listings: [{ goodsKey: "121111", optionId: "1", active: true }],
      },
    ],
    [
      { goods_key: "121111", sale_price: "3000", optId: "1", optAmt: "0" },
      { goods_key: "121111", sale_price: "3100", optId: "1", optAmt: "0" },
    ],
  );
  assert.equal(snapshot.rows[0].state, "CONFLICT");
  assert.equal(snapshot.rows[0].priceMode, "UNRESOLVED");
});

test("live price reader is read only", () => {
  assert.match(source, /postShoplingXml/);
  assert.match(source, /parseShoplingReadResponse\("products"/);
  assert.match(source, /resolveShoplingCurrentPrices/);
  assert.doesNotMatch(source, /prod_modify_api|priceModify|method:\s*["']PUT["']/i);
});

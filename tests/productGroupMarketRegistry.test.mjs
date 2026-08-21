import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PRODUCT_GROUP_MARKET_REGISTRY,
  getMarketsForProductGroup,
  getShoppingMallIdsForProductGroup,
} from "../src/lib/productGroupMarketRegistry.ts";

const EXPECTED = {
  도매1: [
    ["카페24(1.9)", "SMALL_00014"],
    ["도매꾹", "SMALL_00069"],
    ["오너클랜", "SMALL_00107"],
    ["셀파", "SMALL_00116"],
    ["투비즈온", "SMALL_00179"],
  ],
  도매2: [
    ["도매꾹", "SMALL_00069"],
    ["오너클랜", "SMALL_00107"],
    ["셀파", "SMALL_00116"],
  ],
  도매3: [
    ["도매꾹", "SMALL_00069"],
    ["오너클랜", "SMALL_00107"],
    ["셀파", "SMALL_00116"],
  ],
  도매4: [["도매꾹", "SMALL_00069"]],
  소매1: [
    ["옥션", "SMALL_00001"],
    ["지마켓", "SMALL_00002"],
    ["11번가", "SMALL_00003"],
    ["스마트스토어", "SMALL_00004"],
    ["GS SHOP", "SMALL_00005"],
    ["쿠팡", "SMALL_00012"],
    ["신세계몰", "SMALL_00019"],
    ["카카오톡 스토어", "SMALL_00101"],
    ["에이블리", "SMALL_00112"],
    ["롯데ON", "SMALL_00130"],
    ["인큐텐", "SMALL_00168"],
    ["토스쇼핑", "SMALL_00194"],
  ],
  소매2: [
    ["옥션", "SMALL_00001"],
    ["지마켓", "SMALL_00002"],
    ["11번가", "SMALL_00003"],
    ["쿠팡", "SMALL_00012"],
    ["토스쇼핑", "SMALL_00194"],
  ],
};

test("Shopling product groups expand only to the approved automated malls and IDs", () => {
  for (const [group, expected] of Object.entries(EXPECTED)) {
    const markets = getMarketsForProductGroup(group);
    assert.deepEqual(
      markets.map((market) => [market.marketName, market.mallKey]),
      expected,
      group,
    );
    assert.deepEqual(
      getShoppingMallIdsForProductGroup(group),
      expected.map(([, mallId]) => mallId),
      `${group} mall IDs`,
    );
  }
  assert.equal(PRODUCT_GROUP_MARKET_REGISTRY.length, 29);
});

test("manual-category malls stay outside automatic product-group expansion", () => {
  const automatedNames = new Set(PRODUCT_GROUP_MARKET_REGISTRY.map((market) => market.marketName));
  for (const manualMall of ["도매창고", "셀링콕", "도매아토즈", "셀리어스", "도매의신"]) {
    assert.equal(automatedNames.has(manualMall), false, manualMall);
  }
});

test("product upload expansion continues to send the registry mallKey as Shopling mall_key", () => {
  const source = readFileSync("src/lib/productTitleVariants.ts", "utf8");
  assert.match(source, /getMarketsForProductGroup/);
  assert.match(source, /mall_key:\s*market\.mallKey/);
});

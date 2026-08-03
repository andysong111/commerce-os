import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  extractCanonicalPriceTargetsFromTrackerItem,
  extractCanonicalPriceTargetsFromUploadResult,
  isCanonicalPricePolicyResultSuccess,
  SHOPLING_CANONICAL_PRICE_POLICY_VERSION,
} from "../src/lib/shoplingCanonicalPricePolicy.ts";

const uploadRows = [
  ["121001", "도매1", "AAA1-1a"],
  ["121002", "도매2", "AAA1-1b"],
  ["121003", "도매3", "AAA1-1c"],
  ["121004", "도매4", "AAA1-1d"],
  ["121005", "소매1", "AAA1-1e"],
  ["121006", "소매2", "AAA1-1f"],
].map(([goods_key, channel, ptn_goods_cd]) => ({
  goods_key,
  channel,
  ptn_goods_cd,
  code: "000",
  status: "success",
  success: true,
}));

test("상품등록 결과를 중앙 가격정책의 goods_key·상품그룹 입력으로 정규화한다", () => {
  const targets = extractCanonicalPriceTargetsFromUploadResult({
    status: "success",
    phase: "artifact_ready",
    summary: { status: "success", fail_count: 0, rows: uploadRows },
  });
  assert.deepEqual(targets.goodsKeys, [
    "121001",
    "121002",
    "121003",
    "121004",
    "121005",
    "121006",
  ]);
  assert.deepEqual(targets.groupMap, {
    121001: "도매1",
    121002: "도매2",
    121003: "도매3",
    121004: "도매4",
    121005: "소매1",
    121006: "소매2",
  });
  assert.equal(targets.failedRowCount, 0);
  assert.equal(JSON.parse(targets.goodsKeyGroupJson)["121006"], "소매2");
});

test("진행관리의 6채널 등록결과도 동일한 중앙 가격정책 입력으로 변환한다", () => {
  const item = {
    shoplingProducts: {
      wholesale1: { goodsKey: "121001", status: "success" },
      wholesale2: { goodsKey: "121002", status: "success" },
      wholesale3: { goodsKey: "121003", status: "success" },
      wholesale4: { goodsKey: "121004", status: "success" },
      retail1: { goodsKey: "121005", status: "success" },
      retail2: { goodsKey: "121006", status: "success" },
    },
  };
  const targets = extractCanonicalPriceTargetsFromTrackerItem(item);
  assert.equal(targets.goodsKeys.length, 6);
  assert.equal(targets.failedRowCount, 0);
  assert.equal(targets.groupMap["121001"], "도매1");
  assert.equal(targets.groupMap["121006"], "소매2");
});

test("가격정책 성공은 상품 수와 모든 실패·불일치 수가 0일 때만 인정한다", () => {
  const success = {
    status: "success",
    phase: "artifact_ready",
    summary: {
      status: "success",
      goods_key_count: 6,
      fail_count: 0,
      missing_price_count: 0,
      missing_mall_row_count: 0,
      mismatch_count: 0,
      product_level_price_failed_count: 0,
    },
  };
  assert.equal(isCanonicalPricePolicyResultSuccess(success, 6), true);
  assert.equal(
    isCanonicalPricePolicyResultSuccess(
      { ...success, summary: { ...success.summary, mismatch_count: 1 } },
      6,
    ),
    false,
  );
  assert.equal(
    isCanonicalPricePolicyResultSuccess(
      { ...success, summary: { ...success.summary, goods_key_count: 5 } },
      6,
    ),
    false,
  );
  assert.equal(SHOPLING_CANONICAL_PRICE_POLICY_VERSION, "2026-08-03-v1");
});

test("두 상품등록 화면은 중앙 가격정책 브리지를 렌더링한다", async () => {
  const standalonePage = await readFile(
    new URL("../src/app/shopling-product-upload-runner/page.tsx", import.meta.url),
    "utf8",
  );
  const standaloneBridge = await readFile(
    new URL(
      "../src/components/shopling-product-upload-runner/ShoplingProductUploadCanonicalPriceBridge.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const trackerPage = await readFile(
    new URL("../src/app/product-launch-tracker/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(standalonePage, /ShoplingProductUploadCanonicalPriceBridge/);
  assert.match(standaloneBridge, /\/api\/shopling-price-modify\/run/);
  assert.match(standaloneBridge, /canonical_after_standalone_product_upload/);
  assert.match(standaloneBridge, /goods_key_group_json/);
  assert.match(trackerPage, /ProductLaunchTrackerCanonicalPriceBridge/);
});

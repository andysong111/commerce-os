import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { reconcileProductLaunchShoplingReadback } from "../src/lib/productLaunchShoplingReadback.ts";

function uploadRows() {
  return [
    ["도매1", "wholesale1", "121636", "DM1_PL3DKER5X3NZ"],
    ["도매2", "wholesale2", "121637", "DM2_PL3DKER5X3NZ"],
    ["도매3", "wholesale3", "121638", "DM3_PL3DKER5X3NZ"],
    ["도매4", "wholesale4", "121639", "DM4_PL3DKER5X3NZ"],
    ["소매1", "retail1", "121640", "SM1_PL3DKER5X3NZ"],
    ["소매2", "retail2", "121641", "SM2_PL3DKER5X3NZ"],
  ].map(([channel, channel_key, goods_key, ptn_goods_cd]) => ({
    channel,
    channel_key,
    goods_key,
    ptn_goods_cd,
    status: "success",
    code: "000",
    message: "정상",
  }));
}

function liveRows() {
  return uploadRows().map((row) => ({
    goods_key: row.goods_key,
    ptn_goods_cd: row.ptn_goods_cd,
    prod_nm: `상품 ${row.channel}`,
  }));
}

test("Shopling 등록 응답 6개 goods_key가 실재 상품조회에서도 확인돼야 success다", () => {
  const result = reconcileProductLaunchShoplingReadback(uploadRows(), liveRows());
  assert.equal(result.status, "success");
  assert.equal(result.expectedCount, 6);
  assert.equal(result.verifiedCount, 6);
  assert.deepEqual(result.missingIdentifiers, []);
  assert.equal(result.rows.every((row) => row.readback_verified === true), true);
});

test("응답 goods_key가 달라도 자사상품코드가 실재하면 Shopling의 실제 goods_key로 교정한다", () => {
  const live = liveRows().map((row, index) => ({
    ...row,
    goods_key: String(900001 + index),
  }));
  const result = reconcileProductLaunchShoplingReadback(uploadRows(), live);
  assert.equal(result.status, "success");
  assert.deepEqual(
    result.rows.map((row) => row.goods_key),
    ["900001", "900002", "900003", "900004", "900005", "900006"],
  );
});

test("6개 중 하나라도 Shopling 실재 조회에서 없으면 완료가 아니라 partial_failure다", () => {
  const result = reconcileProductLaunchShoplingReadback(uploadRows(), liveRows().slice(0, 5));
  assert.equal(result.status, "partial_failure");
  assert.equal(result.verifiedCount, 5);
  assert.equal(result.missingIdentifiers.length, 1);
  assert.equal(result.rows[5].goods_key, "");
  assert.equal(result.rows[5].status, "failed");
  assert.equal(result.rows[5].code, "SHOPLING_READBACK_NOT_FOUND");
});

test("응답만 성공이고 Shopling에 6개 모두 없으면 유령 goods_key를 성공 처리하지 않는다", () => {
  const result = reconcileProductLaunchShoplingReadback(uploadRows(), []);
  assert.equal(result.status, "failed");
  assert.equal(result.verifiedCount, 0);
  assert.equal(result.missingIdentifiers.length, 6);
  assert.equal(result.rows.every((row) => row.goods_key === ""), true);
});

test("Shopling callback은 실재 readback 뒤에만 job/tracker를 확정한다", async () => {
  const source = await readFile(
    new URL(
      "../src/app/api/product-launch-tracker/upload-jobs/[jobId]/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const verificationIndex = source.indexOf("verifyProductLaunchShoplingReadback");
  const patchIndex = source.indexOf("await patchJob(config.value, jobId");
  const trackerIndex = source.indexOf("await applyResultToTrackerState");
  assert.ok(verificationIndex >= 0);
  assert.ok(patchIndex > verificationIndex);
  assert.ok(trackerIndex > patchIndex);
  assert.match(source, /readback_verification: readback\.verification/);
  assert.match(source, /status: readback\.status/);
  assert.match(source, /goodsKey: succeeded \? String\(row\.goods_key/);
  assert.match(source, /startCanonicalPricePolicy\(item, input/);
  assert.match(source, /if \(input\.status !== "success"\) return/);
});

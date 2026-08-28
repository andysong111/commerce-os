import assert from "node:assert/strict";
import test from "node:test";
import { matchVerifiedShoplingUploadToSeoRun } from "../src/lib/productLaunchShoplingRegistrationTruth.ts";

const base = "PLRDAFEEE8E40";
const channelDefs = [
  ["wholesale1", "a", "도매1"],
  ["wholesale2", "b", "도매2"],
  ["wholesale3", "c", "도매3"],
  ["wholesale4", "d", "도매4"],
  ["retail1", "e", "소매1"],
  ["retail2", "f", "소매2"],
];

function run(overrides = {}) {
  return {
    run_id: "seo-run-test",
    launch_item_id: "launch-test",
    registration_payload: { newSelfCodeBase: base },
    ...overrides,
  };
}

function job(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    launch_item_id: "launch-test",
    request_id: "product-launch-test",
    status: "success",
    completed_at: "2026-08-28T04:54:42.688Z",
    payload: {
      channels: channelDefs.map(([key, suffix]) => ({
        key,
        ptnGoodsCd: `${base}${suffix}`,
      })),
    },
    result: {
      status: "success",
      success_count: 6,
      failed_count: 0,
      readback_verification: { verified: true },
      rows: channelDefs.map(([key, , label], index) => ({
        channel_key: key,
        channel: label,
        status: "success",
        code: "000",
        goods_key: String(121672 + index),
      })),
    },
    ...overrides,
  };
}

test("같은 launch item과 이번 RUN selfCode가 6채널 모두 일치한 readback 성공만 실등록 진실값으로 인정한다", () => {
  const truth = matchVerifiedShoplingUploadToSeoRun(run(), job());
  assert.ok(truth);
  assert.equal(truth.selfCodeBase, base);
  assert.equal(truth.jobId, "11111111-1111-4111-8111-111111111111");
  assert.deepEqual(truth.goodsKeys, ["121672", "121673", "121674", "121675", "121676", "121677"]);
});

test("과거 다른 selfCode의 성공 job은 같은 상품이어도 현재 RUN 성공으로 오인하지 않는다", () => {
  const wrongJob = job({
    payload: {
      channels: channelDefs.map(([key, suffix]) => ({
        key,
        ptnGoodsCd: `PLOLDREGISTRATION${suffix}`,
      })),
    },
  });
  assert.equal(matchVerifiedShoplingUploadToSeoRun(run(), wrongJob), null);
});

test("Shopling readback 검증이 없거나 6채널이 완전하지 않으면 자동 성공 복구를 차단한다", () => {
  const unverified = job({
    result: {
      ...job().result,
      readback_verification: { verified: false },
    },
  });
  assert.equal(matchVerifiedShoplingUploadToSeoRun(run(), unverified), null);

  const partial = job({
    result: {
      ...job().result,
      success_count: 5,
      failed_count: 1,
      rows: job().result.rows.slice(0, 5),
    },
  });
  assert.equal(matchVerifiedShoplingUploadToSeoRun(run(), partial), null);
});

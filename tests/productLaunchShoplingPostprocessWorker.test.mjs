import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isSeoRunShoplingPostprocessCandidate,
} from "../src/lib/productLaunchShoplingPostprocessWorker.ts";

function registeredItem() {
  return {
    id: "launch-test",
    seoRunDispatch: {
      status: "success",
      seoRunId: "seo-run-test",
    },
    shoplingProducts: {
      wholesale1: { status: "success", goodsKey: "100001" },
      wholesale2: { status: "success", goodsKey: "100002" },
      wholesale3: { status: "success", goodsKey: "100003" },
      wholesale4: { status: "success", goodsKey: "100004" },
      retail1: { status: "success", goodsKey: "100005" },
      retail2: { status: "success", goodsKey: "100006" },
    },
    pricePolicy: null,
    mallSeoApply: null,
  };
}

test("SEO RUN 등록 성공 + 6 goods_key + 후처리 누락만 복구 대상으로 잡는다", () => {
  const item = registeredItem();
  assert.equal(isSeoRunShoplingPostprocessCandidate(item), true);

  assert.equal(
    isSeoRunShoplingPostprocessCandidate({
      ...item,
      seoRunDispatch: { status: "failed", seoRunId: "seo-run-test" },
    }),
    false,
  );

  const incomplete = registeredItem();
  incomplete.shoplingProducts.retail2 = { status: "failed", goodsKey: "" };
  assert.equal(isSeoRunShoplingPostprocessCandidate(incomplete), false);

  const complete = registeredItem();
  complete.pricePolicy = { status: "success" };
  complete.mallSeoApply = { status: "success" };
  assert.equal(isSeoRunShoplingPostprocessCandidate(complete), false);
});

test("Shopling 서버 pulse가 가격과 쇼핑몰별 상품명 후처리를 PC와 무관하게 복구한다", async () => {
  const worker = await readFile(
    new URL("../src/lib/productLaunchShoplingPostprocessWorker.ts", import.meta.url),
    "utf8",
  );
  const pulseWork = await readFile(
    new URL("../src/lib/seoRunShoplingPulseWork.ts", import.meta.url),
    "utf8",
  );
  const wakeup = await readFile(
    new URL("../src/app/api/seo-run-shopling-wakeup/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(worker, /dispatchShoplingPriceModifyActions/);
  assert.match(worker, /fetchShoplingPriceModifyActionsResult/);
  assert.match(worker, /dispatchProductLaunchMallSeo/);
  assert.match(worker, /fetchKeywordShoplingDirectApplyResult/);
  assert.match(worker, /writeProductLaunchState/);
  assert.match(worker, /reconcileProductLaunchNormalizedAfterLegacyItems/);
  assert.match(pulseWork, /processProductLaunchShoplingPostprocessQueue/);
  assert.match(pulseWork, /maxItems: 10/);
  assert.match(wakeup, /runSeoRunShoplingPulseWork/);
});

test("진행관리 상태 쓰기는 PGRST002를 포함한 transient retry helper를 공유한다", async () => {
  const server = await readFile(
    new URL("../src/lib/productLaunchTrackerServer.ts", import.meta.url),
    "utf8",
  );
  const writeBody = server.slice(
    server.indexOf("export async function writeProductLaunchState"),
    server.indexOf("export async function readResponseJson"),
  );
  assert.match(writeBody, /readProductLaunchStorageJson/);
  assert.doesNotMatch(writeBody, /const response = await fetch/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = await readFile(
  new URL("../src/app/product-launch-flow/page.tsx", import.meta.url),
  "utf8",
);
const connectedSource = await readFile(
  new URL(
    "../src/components/product-launch-flow/ProductLaunchFlowConnected.tsx",
    import.meta.url,
  ),
  "utf8",
);
const trackerAppSource = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);
const batchHandoffSource = await readFile(
  new URL(
    "../public/product-launch-tracker-app/product-launch-flow-batch-handoff.js",
    import.meta.url,
  ),
  "utf8",
);

test("상품출시플로우는 실재고 입력 화면 대신 진행관리 연결 화면을 사용한다", () => {
  assert.match(pageSource, /ProductLaunchFlowConnected/);
  assert.doesNotMatch(pageSource, /<ProductLaunchFlowSimple\s*\/>/);
  assert.match(pageSource, /상품출시진행관리 행번호/);
  assert.match(connectedSource, /flow-selection/);
  assert.match(connectedSource, /진행관리 상품 선택/);
});

test("진행관리 표에 행번호와 체크 선택 일괄 전달 기능이 연결된다", () => {
  assert.match(trackerAppSource, /product-launch-flow-batch-handoff\.js/);
  assert.match(batchHandoffSource, /trackerRowNumberHeader/);
  assert.match(batchHandoffSource, /선택 상품을 출시플로우로 등록 진행/);
  assert.match(batchHandoffSource, /productLaunchFlow\.trackerBatchSelection\.v1/);
  assert.match(batchHandoffSource, /MAX_SELECTION = 20/);
});

test("등록 작업은 기존 진행관리 샵플링 API를 재사용하고 새로고침 복구 정보를 저장한다", () => {
  assert.match(connectedSource, /product-launch-tracker\/shopling-upload/);
  assert.match(connectedSource, /productLaunchFlow\.trackerBatchRun\.v1/);
  assert.match(connectedSource, /currentJobId/);
  assert.match(connectedSource, /registrationPartial/);
  assert.match(connectedSource, /registrationComplete/);
});

test("샵플링 등록 후 중앙 가격정책 확인기가 같은 상품출시플로우 화면에서 계속 실행된다", () => {
  assert.match(pageSource, /ProductLaunchTrackerCanonicalPriceBridge/);
  assert.match(pageSource, /<ProductLaunchTrackerCanonicalPriceBridge\s*\/>/);
  assert.match(connectedSource, /pricePolicy\.status/);
});

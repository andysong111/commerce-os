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
const trackerPageSource = await readFile(
  new URL("../src/app/product-launch-tracker/page.tsx", import.meta.url),
  "utf8",
);
const completedArchiveBridgeSource = await readFile(
  new URL(
    "../src/components/product-launch-flow/ProductLaunchCompletedArchiveButtonBridge.tsx",
    import.meta.url,
  ),
  "utf8",
);
const trackerAppSource = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);
const workflowGateSource = await readFile(
  new URL("../public/product-launch-tracker-app/workflow-ui-gate.js", import.meta.url),
  "utf8",
);
const optimizedTrackerSource = await readFile(
  new URL(
    "../public/product-launch-tracker-app/optimized-app.js",
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

test("진행관리 표의 일괄 전달 기능은 건강한 Workflow gate 뒤의 최적화 앱에 통합된다", () => {
  assert.match(trackerAppSource, /workflow-ui-gate\.js/);
  assert.match(workflowGateSource, /import\("\.\/optimized-app\.js"\)/);
  assert.match(workflowGateSource, /installWarmWorkflowPage/);
  assert.match(optimizedTrackerSource, /optimized-row-number/);
  assert.match(optimizedTrackerSource, /선택 상품을 출시플로우로 등록 진행/);
  assert.match(
    optimizedTrackerSource,
    /productLaunchFlow\.trackerBatchSelection\.v1/,
  );
  assert.match(optimizedTrackerSource, /MAX_PRODUCT_FLOW_SELECTION = 20/);
  assert.doesNotMatch(trackerAppSource, /product-launch-flow-batch-handoff\.js/);
});

test("등록완료건 화면은 선택 상품을 보관함으로 옮기는 전용 버튼을 제공한다", () => {
  assert.match(trackerPageSource, /ProductLaunchCompletedArchiveButtonBridge/);
  assert.match(trackerPageSource, /id="product-launch-tracker-frame"/);
  assert.match(completedArchiveBridgeSource, /button\.textContent = "보관함 이동"/);
  assert.match(completedArchiveBridgeSource, /overall\.value !== "완료"/);
  assert.match(completedArchiveBridgeSource, /#launch-table-body \.row-check:checked/);
  assert.match(completedArchiveBridgeSource, /tr\[data-id\]/);
  assert.match(completedArchiveBridgeSource, /operation: "archive_items"/);
  assert.match(completedArchiveBridgeSource, /archived: true/);
  assert.match(completedArchiveBridgeSource, /등록완료건 보관함 이동/);
  assert.match(completedArchiveBridgeSource, /win\.location\.reload\(\)/);
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

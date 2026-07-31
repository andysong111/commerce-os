import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);
const resetUi = await readFile(
  new URL(
    "../public/product-launch-tracker-app/relaunch-reset-fixed.js",
    import.meta.url,
  ),
  "utf8",
);

test("진행관리 앱은 상세창 반복 감시가 없는 재출시 스크립트를 사용한다", () => {
  assert.match(app, /relaunch-reset-fixed\.js/);
  assert.doesNotMatch(app, /relaunch-reset\.js/);
  assert.doesNotMatch(
    resetUi,
    /observer\.observe\(detailDialog|MutationObserver\(\(\) => decorateCurrentDetail/,
  );
  assert.match(resetUi, /scheduleDetailDecoration/);
  assert.match(resetUi, /\[0, 60, 180\]/);
});

test("재출시 이력 패널은 같은 내용이면 다시 만들지 않는다", () => {
  assert.match(resetUi, /historyFingerprint/);
  assert.match(resetUi, /existing\?\.dataset\.historyFingerprint === fingerprint/);
  assert.match(resetUi, /if \(!existing\) anchor\.before\(section\)/);
});

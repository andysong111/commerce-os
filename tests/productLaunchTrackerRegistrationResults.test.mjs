import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const uploadUi = await readFile(
  new URL(
    "../public/product-launch-tracker-app/shopling-upload-ui.js",
    import.meta.url,
  ),
  "utf8",
);

test("등록 완료 상품은 완료 문구와 goods_key 6개를 표시한다", () => {
  assert.match(uploadUi, /6개 상품 등록완료/);
  assert.match(uploadUi, /샵플링 6채널 등록완료/);
  assert.match(uploadUi, /goods_key 6개가 저장되었습니다/);
  assert.match(uploadUi, /goodsKeyHeader/);
});

test("상품 상세에 채널별 goods_key 결과 패널을 표시한다", () => {
  assert.match(uploadUi, /shopling-registration-result-panel/);
  assert.match(uploadUi, /샵플링 등록 결과/);
  assert.match(uploadUi, /등록 시각/);
});

test("등록된 goods_key가 하나라도 있으면 재등록을 차단한다", () => {
  assert.match(uploadUi, /registration\.registeredCount > 0/);
  assert.match(uploadUi, /일부 채널 등록됨/);
});

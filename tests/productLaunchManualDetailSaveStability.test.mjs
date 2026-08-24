import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manualSource = await readFile(
  new URL(
    "../public/product-launch-tracker-app/manual-detail-save-stability.js",
    import.meta.url,
  ),
  "utf8",
);
const detailStateSource = await readFile(
  new URL(
    "../public/product-launch-tracker-app/detail-state-stability.js",
    import.meta.url,
  ),
  "utf8",
);

test("수동 상세 저장은 전체 교체를 부분 패치로 바꾸되 충돌 응답을 자동 재시도하지 않는다", () => {
  assert.match(manualSource, /originalPayload\?\.operation !== "replace_item"/);
  assert.match(manualSource, /operation: "patch_item"/);
  assert.match(manualSource, /updatedBy: MANUAL_SAVE_UPDATED_BY/);
  assert.doesNotMatch(manualSource, /RETRY_DELAYS_MS/);
  assert.doesNotMatch(manualSource, /CONCURRENT_UPDATE_CODE/);
  assert.doesNotMatch(manualSource, /for \(let attempt/);
});

test("수동 상세 패치도 기존 저장 권위 계층에서 옵션 바코드 보존과 서버 재조회 검증을 거친다", () => {
  assert.match(detailStateSource, /mutation\?\.operation === "patch_item"/);
  assert.match(detailStateSource, /mutation\.updatedBy === MANUAL_SAVE_UPDATED_BY/);
  assert.match(detailStateSource, /enrichManualPatchMutation\(mutation\)/);
  assert.match(detailStateSource, /verifyPersistedPatch\(/);
  assert.match(detailStateSource, /comparePatchedItem\(/);
  assert.match(detailStateSource, /detailPageAsset/);
  assert.match(detailStateSource, /additionalImageUrls/);
  assert.match(detailStateSource, /상세페이지 단계/);
});

test("저장 검증 실패는 성공으로 통과시키지 않고 409 응답으로 차단한다", () => {
  const manualPatchBranch = detailStateSource.slice(
    detailStateSource.indexOf("if (isManualDetailPatch(mutation))"),
    detailStateSource.indexOf("return originalFetch(input, init);", detailStateSource.indexOf("if (isManualDetailPatch(mutation))")),
  );

  assert.match(manualPatchBranch, /if \(!response\.ok\) return response/);
  assert.match(manualPatchBranch, /if \(!verification\.ok\)/);
  assert.match(manualPatchBranch, /jsonErrorResponse\(\s*409/);
  assert.match(manualPatchBranch, /저장 확인 실패/);
});

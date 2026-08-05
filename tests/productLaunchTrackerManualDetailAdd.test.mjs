import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildManualDetailDraftState,
  finishManualDetailDraftState,
  nextManualTrackerRowNumber,
} from "../public/product-launch-tracker-app/manual-detail-add.js";

const appSource = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);
const moduleSource = await readFile(
  new URL("../public/product-launch-tracker-app/manual-detail-add.js", import.meta.url),
  "utf8",
);

test("상품 추가는 대량 붙여넣기보다 기존 출시 항목 상세 화면을 연다", () => {
  const manualIndex = appSource.indexOf("manual-detail-add.js");
  const legacyIndex = appSource.indexOf("single-row-add.js");
  assert.ok(manualIndex >= 0);
  assert.ok(legacyIndex > manualIndex);
  assert.match(moduleSource, /cloneNode\(true\)/);
  assert.match(moduleSource, /#detail-dialog/);
  assert.match(moduleSource, /#detail-form/);
  assert.match(moduleSource, /\+ 상품 추가/);
  assert.match(moduleSource, /새 상품 수동 입력/);
  assert.doesNotMatch(moduleSource, /#add-dialog/);
});

test("새 상품 초안은 다음 행번호와 자동 코드를 만들고 상세 입력용 단품 옵션을 준비한다", () => {
  const stored = {
    schemaVersion: 3,
    serverDeletedItemIds: ["deleted-1"],
    policy: { version: 2 },
    items: [
      {
        id: "existing-1",
        trackerRowNumber: 2500,
        selfCodeBase: "PLEXISTING1",
      },
      {
        id: "existing-2",
        source: { rows: [2510] },
        selfCodeBase: "PLEXISTING2",
      },
    ],
  };
  assert.equal(nextManualTrackerRowNumber(stored.items), 2511);

  const result = buildManualDetailDraftState(
    stored,
    "2026-08-06T00:50:00.000Z",
    {
      idFactory: () => "manual-new-item",
      optionIdFactory: () => "manual-option-1",
      codeFactory: () => "PLMANUAL001",
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.item.id, "manual-new-item");
  assert.equal(result.item.trackerRowNumber, 2511);
  assert.equal(result.item.workBatch, "신규 입고");
  assert.equal(result.item.selfCodeBase, "PLMANUAL001");
  assert.equal(result.item.manualDetailDraft, true);
  assert.equal(result.item.orderOptions.length, 1);
  assert.equal(result.item.orderOptions[0].optionName, "옵션");
  assert.equal(result.item.orderOptions[0].saleOption, "단품");
  assert.deepEqual(result.state.serverDeletedItemIds, ["deleted-1"]);
  assert.deepEqual(result.state.policy, { version: 2 });
});

test("취소하면 수동 초안을 제거하고 저장하면 같은 행을 정식 상품으로 남긴다", () => {
  const draft = buildManualDetailDraftState(
    { schemaVersion: 3, items: [] },
    "2026-08-06T00:50:00.000Z",
    {
      idFactory: () => "manual-new-item",
      optionIdFactory: () => "manual-option-1",
      codeFactory: () => "PLMANUAL001",
    },
  );

  const cancelled = finishManualDetailDraftState(
    draft.state,
    "manual-new-item",
    false,
    "2026-08-06T00:51:00.000Z",
  );
  assert.equal(cancelled.changed, true);
  assert.equal(cancelled.state.items.length, 0);

  const savedInput = {
    ...draft.state,
    items: draft.state.items.map((item) => ({
      ...item,
      modelNumber: "AAA500",
      productName: "수동 입력 상품",
    })),
  };
  const saved = finishManualDetailDraftState(
    savedInput,
    "manual-new-item",
    true,
    "2026-08-06T00:52:00.000Z",
  );
  assert.equal(saved.changed, true);
  assert.equal(saved.state.items.length, 1);
  assert.equal(saved.item.modelNumber, "AAA500");
  assert.equal(saved.item.productName, "수동 입력 상품");
  assert.equal("manualDetailDraft" in saved.item, false);
});

test("새 상품 저장 직전에 단일 옵션 바코드를 기준바코드와 맞추고 모델번호 중복을 차단한다", () => {
  assert.match(moduleSource, /syncSingleOptionBarcode\(form\)/);
  assert.match(moduleSource, /normalizeBarcode\(mainInput\.value \|\| optionInput\.value\)/);
  assert.match(moduleSource, /모델번호가 이미 존재합니다/);
});

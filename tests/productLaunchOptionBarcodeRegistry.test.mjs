import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { importTranspiledTypeScript } from "./transpileTypeScript.mjs";

const {
  buildOptionBarcodeIdentity,
  canonicalizeOptionSetComposition,
  normalizeOptionBCode,
} = await importTranspiledTypeScript(
  new URL("../src/lib/productLaunchOptionBarcodeRegistry.ts", import.meta.url),
);

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("B코드는 공백과 대소문자를 제거해 동일 identity로 수렴한다", () => {
  assert.equal(normalizeOptionBCode(" bgb1-1 "), "BGB1-1");
  const left = buildOptionBarcodeIdentity({
    ownerId: "owner",
    itemId: "item-a",
    optionId: "opt-a",
    option: { barcode: "bgb1-1" },
  });
  const right = buildOptionBarcodeIdentity({
    ownerId: "owner",
    itemId: "item-b",
    optionId: "opt-b",
    option: { barcode: " BGB1-1 " },
  });
  assert.equal(left.identityKey, "B:BGB1-1");
  assert.equal(right.identityKey, left.identityKey);
  assert.equal(left.identityKind, "B_CODE");
});

test("B코드가 없는 옵션은 상품·옵션별 임시 identity를 갖는다", () => {
  const identity = buildOptionBarcodeIdentity({
    ownerId: "owner-1",
    itemId: "item-1",
    optionId: "option-1",
    option: { saleOption: "단품" },
  });
  assert.equal(identity.identityKey, "OPTION:owner-1:item-1:option-1");
  assert.equal(identity.identityKind, "OPTION");
});

test("세트 구성은 입력 순서와 무관하게 같은 identity를 만들고 수량이 다르면 새 identity가 된다", () => {
  const compositionA = [
    { bCode: "BAA1-1", option: "블랙", quantity: 2 },
    { bCode: "BAA1-2", option: "화이트", quantity: 1 },
  ];
  const compositionB = [...compositionA].reverse();
  assert.deepEqual(
    canonicalizeOptionSetComposition(compositionA),
    canonicalizeOptionSetComposition(compositionB),
  );

  const setA = buildOptionBarcodeIdentity({
    ownerId: "owner",
    itemId: "set-a",
    optionId: "set-opt-a",
    option: { setComposition: compositionA },
  });
  const setB = buildOptionBarcodeIdentity({
    ownerId: "owner",
    itemId: "set-b",
    optionId: "set-opt-b",
    option: { setComposition: compositionB },
  });
  const differentQuantity = buildOptionBarcodeIdentity({
    ownerId: "owner",
    itemId: "set-c",
    optionId: "set-opt-c",
    option: {
      setComposition: [
        { bCode: "BAA1-1", option: "블랙", quantity: 3 },
        { bCode: "BAA1-2", option: "화이트", quantity: 1 },
      ],
    },
  });

  assert.match(setA.identityKey, /^SET:[A-F0-9]{32}$/);
  assert.equal(setA.identityKind, "SET");
  assert.equal(setA.identityKey, setB.identityKey);
  assert.notEqual(setA.identityKey, differentQuantity.identityKey);
});

test("옵션바코드NO는 Shopling 등록 직전에 DB가 반드시 자동발급하고 legacy payload까지 동기화한다", async () => {
  const migration = await source(
    "supabase/migrations/202608290002_option_barcode_auto_issue_guard.sql",
  );
  assert.match(migration, /create or replace function public\.sync_product_launch_option_barcode_columns/);
  assert.match(migration, /resolve_option_barcode_nos/);
  assert.match(migration, /v_identity := 'B:' \|\| v_bcode/);
  assert.match(migration, /OPTION_BARCODE_AUTO_ISSUE_FAILED/);
  assert.match(migration, /ensure_product_launch_item_option_barcode_nos/);
  assert.match(migration, /product_launch_tracker_states/);
  assert.match(migration, /optionBarcodeNos/);
  assert.match(migration, /trg_seo_run_option_barcode_preflight/);
  assert.match(migration, /before update of registration_status on public\.seo_run_jobs/);
  assert.match(migration, /registration_status in \('queued', 'submitting'\)/);
  assert.match(migration, /like '%옵션바코드NO%'/);
  assert.match(migration, /wake_ops_dispatch_task\('seo-run-worker', 0\)/);
  assert.doesNotMatch(migration, /cron\.schedule/);
});

test("SEO 실패 화면은 옵션바코드NO를 운영자 입력값으로 안내하지 않는다", async () => {
  const panel = await source(
    "src/app/seo-bulk-cloud/SeoBulkRegistrationFailurePanel.tsx",
  );
  assert.match(panel, /옵션바코드NO는 운영자가 입력하는 값이 아닙니다/);
  assert.match(panel, /서버가 등록 직전에 12자리 번호를 자동발급·저장합니다/);
  assert.doesNotMatch(panel, /옵션바코드NO가 숫자 12자리인지 확인하고 자동발급\/저장을 완료하세요/);
});

test("직접 Shopling 업로드도 payload 생성 전에 옵션바코드NO 자동발급 preflight를 실행한다", async () => {
  const route = await source(
    "src/app/api/product-launch-tracker/shopling-upload/route.ts",
  );
  const preflight = route.indexOf("await ensureOptionBarcodeNos(");
  const readState = route.indexOf("const stateRow = await readProductLaunchState(");
  const buildPayload = route.indexOf("buildProductLaunchShoplingPayload(");
  assert.ok(preflight >= 0);
  assert.ok(readState > preflight);
  assert.ok(buildPayload > readState);
  assert.match(route, /rpc\/ensure_product_launch_item_option_barcode_nos/);
  assert.match(route, /p_owner_id: ownerId/);
  assert.match(route, /p_item_id: itemId/);
});

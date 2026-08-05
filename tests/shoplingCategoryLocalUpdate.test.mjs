import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateLocalShoplingCategorySnapshot } from "../src/lib/shoplingCategoryLocalPublish.ts";

test("로컬 샵플링 카테고리 스냅샷을 검증하고 정규화한다", () => {
  const collectedAt = new Date().toISOString();
  const snapshot = validateLocalShoplingCategorySnapshot({
    schemaVersion: 1,
    source: "shopling_local_playwright",
    status: "success",
    requestId: "shopling-local-test-1",
    collectedAt,
    categoryPageUrl: "https://a.shopling.co.kr/prod/prodInfo.phtml?mode=reg",
    categories: [
      {
        depth: 4,
        path: "스포츠/레저>헬스기구>스트레칭용품>짐볼",
        names: ["스포츠/레저", "헬스기구", "스트레칭용품", "짐볼"],
        codes: ["1", "11", "111", "1111"],
      },
      {
        depth: 4,
        path: "스포츠/레저>헬스기구>스트레칭용품>짐볼",
        names: ["스포츠/레저", "헬스기구", "스트레칭용품", "짐볼"],
        codes: ["1", "11", "111", "1111"],
      },
    ],
  });
  assert.equal(snapshot.categoryCount, 1);
  assert.equal(snapshot.source, "shopling_local_playwright");
  assert.match(snapshot.hash, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.categories[0].path, "스포츠/레저>헬스기구>스트레칭용품>짐볼");
});

test("카테고리 업데이트 버튼은 GitHub Actions보다 로컬 실행기가 먼저 처리한다", async () => {
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  const local = await readFile(
    new URL(
      "../public/product-launch-tracker-app/category-local-update.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(
    app.indexOf("category-local-update.js") <
      app.indexOf("category-update-progress.js"),
  );
  assert.match(local, /http:\/\/127\.0\.0\.1:8776/);
  assert.match(local, /targetAddressSpace:\s*"local"/);
  assert.doesNotMatch(local, /targetAddressSpace:\s*"loopback"/);
  assert.match(local, /stopImmediatePropagation/);
  assert.match(local, /category-update\/start/);
  assert.match(local, /category-update\/status/);
  assert.match(local, /shopling-categories\/local-result/);
  assert.match(local, /waiting_for_login/);
  assert.match(local, /보안문자 입력 대기 중/);
  assert.match(local, /백그라운드로 보기/);
  assert.match(local, /업데이트 취소/);
});

test("전역 작업 도우미는 로컬 작업 중 클라우드 상태로 덮어쓰지 않는다", async () => {
  const bridge = await readFile(
    new URL("../src/components/OpsLocalCategoryStatusBridge.tsx", import.meta.url),
    "utf8",
  );
  const legacyBridge = await readFile(
    new URL(
      "../public/product-launch-tracker-app/category-update-work-assistant-bridge.js",
      import.meta.url,
    ),
    "utf8",
  );
  const shell = await readFile(
    new URL("../src/components/AppShell.tsx", import.meta.url),
    "utf8",
  );
  assert.match(bridge, /mode === "local"/);
  assert.match(bridge, /CATEGORY_STATUS_PATH/);
  assert.match(bridge, /local_shopling_category_runner/);
  assert.match(legacyBridge, /isLocalCategoryState/);
  assert.match(legacyBridge, /session\?\.mode === "local"/);
  assert.ok(
    shell.indexOf("<OpsLocalCategoryStatusBridge />") <
      shell.indexOf("<OpsWorkAssistant />"),
  );
});

test("실시간 작업 도우미 취소는 로컬 실행기 취소 API를 사용한다", async () => {
  const cancelControl = await readFile(
    new URL(
      "../src/components/OpsCategoryUpdateCancelControl.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(cancelControl, /mode === "local"/);
  assert.match(cancelControl, /127\.0\.0\.1:8776/);
  assert.match(cancelControl, /category-update\/cancel/);
  assert.match(cancelControl, /targetAddressSpace: "local"/);
  assert.match(cancelControl, /category-local-update-cancel/);
});

test("로컬 결과는 운영자 인증 후 Supabase 서버 저장 경로로 전달된다", async () => {
  const route = await readFile(
    new URL(
      "../src/app/api/shopling-categories/local-result/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const publisher = await readFile(
    new URL("../src/lib/shoplingCategoryLocalPublish.ts", import.meta.url),
    "utf8",
  );
  const store = await readFile(
    new URL("../src/lib/shoplingCategorySupabaseStore.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /resolveProductLaunchIdentity/);
  assert.match(route, /publishLocalShoplingCategorySnapshot/);
  assert.match(publisher, /writeShoplingCategoryCatalogToSupabase/);
  assert.doesNotMatch(publisher, /git\/blobs/);
  assert.match(store, /product_launch_tracker_states/);
  assert.match(store, /resolution=merge-duplicates/);
});

test("저장 실패 후 로컬에 보존된 결과는 재수집 없이 자동 저장을 재시도한다", async () => {
  const app = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  const recovery = await readFile(
    new URL(
      "../public/product-launch-tracker-app/category-local-result-recovery.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(
    app.indexOf("category-local-result-recovery.js") >
      app.indexOf("category-local-update.js"),
  );
  assert.match(recovery, /resultReady/);
  assert.match(recovery, /category-update\/result/);
  assert.match(recovery, /shopling-categories\/local-result/);
  assert.match(recovery, /재수집 없이 결과 저장 중/);
  assert.match(recovery, /targetAddressSpace: "local"/);
  assert.match(recovery, /category-update-task-changed/);
});
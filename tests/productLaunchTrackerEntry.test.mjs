import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { moduleRegistry } from "../src/lib/moduleRegistry.ts";

test("신규 상품 출시 진행관리를 상품·출시 업무 영역에서 제공한다", async () => {
  const tracker = moduleRegistry.find(
    (item) => item.id === "product-launch-tracker",
  );
  const workspaceSource = await readFile(
    new URL("../src/lib/opsWorkspace.ts", import.meta.url),
    "utf8",
  );
  const pageSource = await readFile(
    new URL("../src/app/product-launch-tracker/page.tsx", import.meta.url),
    "utf8",
  );

  assert.equal(tracker?.title, "신규 상품 출시 진행관리");
  assert.equal(tracker?.route, "/product-launch-tracker");
  assert.equal(tracker?.status, "available");
  assert.match(workspaceSource, /"product-launch-tracker"/);
  assert.match(workspaceSource, /id: "product-launch"/);
  assert.match(pageSource, /product-launch-tracker-app\/index\.html/);
});

test("업로드 원본의 실제 상품 데이터가 OPS Center 실행본에 포함된다", async () => {
  const launchData = JSON.parse(
    await readFile(
      new URL(
        "../public/product-launch-tracker-app/data/launch-items.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

  assert.equal(
    launchData.meta.sourceFile,
    "동네일등 상품등록 프로세스 (1).xlsx",
  );
  assert.equal(launchData.meta.sourceProductRows, 1630);
  assert.equal(launchData.meta.launchItemCount, 389);
  assert.equal(launchData.meta.distinctModelCount, 359);

  const expected = new Map([
    ["AAA413", "곰돌이 목도리 넥워머"],
    ["AAA414", "곰돌이 방울 털모자"],
    ["AAA444", "투명 라면정리함"],
    ["AAA451", "반자동 책갈피 3P 색상랜덤"],
    ["AAA455", "발편한 등산화"],
    ["AAA456", "메쉬 여성운동화"],
  ]);

  for (const [modelNumber, productName] of expected) {
    assert.ok(
      launchData.items.some(
        (item) =>
          item.workBatch === "제작 예정 상품들" &&
          item.modelNumber === modelNumber &&
          item.productName === productName,
      ),
      `${modelNumber} ${productName} 기록이 필요합니다.`,
    );
  }
});

test("서버가 느리면 최근 정상 목록을 읽기 전용으로 먼저 보여주고 숨은 worker는 대기 작업이 있을 때만 기동한다", async () => {
  const appSource = await readFile(
    new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
    "utf8",
  );
  const previewSource = await readFile(
    new URL(
      "../public/product-launch-tracker-app/startup-page-cache-preview.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(appSource, /startup-page-cache-preview\.js/);
  assert.match(appSource, /installStartupPageCachePreview/);
  assert.match(appSource, /workerIdleCheckMs = 30_000/);
  assert.match(appSource, /hasActiveJob/);
  assert.match(appSource, /ensureWorkerModules/);
  assert.match(appSource, /__commerceWorkerBootstrapForwarded/);

  assert.match(previewSource, /partialPage === true/);
  assert.match(previewSource, /MAX_CACHE_AGE_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(previewSource, /data-startup-cache-preview/);
  assert.match(previewSource, /최근 정상 목록 먼저 표시/);
  assert.match(previewSource, /최근 정상 목록 표시 · 서버 재연결 대기/);
  assert.match(previewSource, /product-launch-tracker:page-loaded/);
  assert.match(previewSource, /lockWrites\(true\)/);
  assert.match(previewSource, /lockWrites\(false\)/);
});

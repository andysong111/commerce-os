import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyChinaProductLinks,
  readChinaProductLinks,
} from "../public/product-launch-tracker-app/lib/china-product-links.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("고정링크 1 삭제 후 후순위 링크가 순서대로 승격된다", () => {
  const item = {
    primaryChinaProductLink: "https://detail.1688.com/offer/111.html",
    chinaProductLinks: [
      "https://detail.1688.com/offer/111.html",
      "https://detail.1688.com/offer/222.html",
      "https://detail.1688.com/offer/333.html",
    ],
    detailPageSource: {
      primaryUrl: "https://detail.1688.com/offer/111.html",
      urls: [
        "https://detail.1688.com/offer/111.html",
        "https://detail.1688.com/offer/222.html",
        "https://detail.1688.com/offer/333.html",
      ],
    },
  };
  const shifted = applyChinaProductLinks(
    item,
    readChinaProductLinks(item).slice(1),
    { now: new Date("2026-08-22T00:00:00.000Z") },
  );
  assert.equal(shifted.primaryChinaProductLink, "https://detail.1688.com/offer/222.html");
  assert.deepEqual(shifted.chinaProductLinks, [
    "https://detail.1688.com/offer/222.html",
    "https://detail.1688.com/offer/333.html",
  ]);
  assert.equal(shifted.detailPageSource.pinnedIndex, 0);
});

test("링크 검사는 페이지 로딩과 분리된 단일창 저속 배치 방식이다", async () => {
  const panel = await read("public/product-launch-tracker-app/china-link-health-panel.js");
  const handoff = await read("public/product-launch-tracker-app/seo-title-ledger-handoff.js");
  const runState = await read("public/product-launch-tracker-app/china-link-health-run-state.js");

  assert.match(panel, /const RESULT_BATCH_SIZE = 10/);
  assert.match(panel, /const BETWEEN_LINK_DELAY_MS = 1_200/);
  assert.match(panel, /window\.open\("about:blank", WORKER_NAME/);
  assert.match(panel, /for \(const row of rows\)/);
  assert.match(panel, /await delay\(BETWEEN_LINK_DELAY_MS\)/);
  assert.match(panel, /CONTEXT_HASH_PARAM/);
  assert.match(panel, /buildAuditUrl\(row, context\)/);
  assert.doesNotMatch(panel, /setInterval\(/);
  assert.match(handoff, /requestIdleCallback/);
  assert.match(handoff, /import\("\.\/china-link-health-panel\.js"\)/);
  assert.match(handoff, /import\("\.\/china-link-health-run-state\.js"\)/);
  assert.match(runState, /commerceOs\.chinaLinkAudit\.run\.v1/);
  assert.match(runState, /최근 .*완료/);
  assert.match(runState, /MutationObserver/);
  assert.doesNotMatch(runState, /setInterval\(/);
});

test("상품출시 iframe은 상위 Ops 문서의 Collector 버전을 재사용한다", async () => {
  const panel = await read("public/product-launch-tracker-app/china-link-health-panel.js");
  assert.match(panel, /window\.parent\.document\.documentElement\.dataset/);
  assert.match(panel, /parentCollectorDocument\.addEventListener/);
  assert.match(panel, /commerce-os-keyword-lab-collector-ready/);
  assert.match(panel, /parentCollectorDocument\?\.removeEventListener/);
});

test("SEO 대량등록 클라우드는 상품출시 화면을 닫지 않고 하나의 전용창을 재사용한다", async () => {
  const handoff = await read("public/product-launch-tracker-app/seo-title-ledger-handoff.js");
  const popupBridge = await read("src/app/keyword-engine-elon-lab/KeywordElonPopupCollectorBridge.tsx");
  assert.match(handoff, /SEO_BULK_WINDOW_NAME = "commerce-os-seo-bulk-cloud"/);
  assert.match(handoff, /window\.open\("", SEO_BULK_WINDOW_NAME\)/);
  assert.match(handoff, /opened\.focus\(\)/);
  assert.doesNotMatch(handoff, /window\.open\(target, "_blank"\)/);
  assert.doesNotMatch(handoff, /window\.top\.location\.assign\(target\)/);
  assert.match(popupBridge, /POPUP_WINDOW_NAME/);
  assert.match(popupBridge, /AUDIT_RUN_KEY/);
  assert.match(popupBridge, /고정링크 전체재검사가 진행 중/);
});

test("Collector는 영구 링크 오류와 일시적 접속 문제를 분리한다", async () => {
  const health = await read("public/keyword-lab-collector/content-1688-health.js");
  const auditV013 = await read("public/keyword-lab-collector/content-1688-audit-v013.js");
  const recoveryV013 = await read("public/keyword-lab-collector/content-1688-recovery-v013.js");
  const manifest = JSON.parse(
    await read("public/keyword-lab-collector/manifest.json"),
  );

  assert.equal(manifest.version, "0.1.3");
  assert.deepEqual(manifest.content_scripts[0].js.slice(0, 4), [
    "content-1688-audit-v013.js",
    "content-1688-recovery-v013.js",
    "content-1688-health.js",
    "content-1688.js",
  ]);
  assert.match(health, /error\\s\*404/);
  assert.match(health, /商品已下架/);
  assert.match(health, /店铺已关闭/);
  assert.match(health, /访问过于频繁/);
  assert.match(health, /login_required/);
  assert.match(health, /temporary_error/);
  assert.match(health, /link_error/);
  assert.match(auditV013, /extractProductTitle/);
  assert.match(auditV013, /empty_or_unreadable/);
  assert.match(recoveryV013, /product_title_unreadable/);
  assert.match(recoveryV013, /window\.alert =/);
});

test("오류 링크 일괄 승격은 동시변경을 차단하고 한 번 저장 후 정규화 원장을 동기화한다", async () => {
  const route = await read(
    "src/app/api/product-launch-tracker/china-link-health/shift/route.ts",
  );
  assert.match(route, /expectedPrimaryUrl && currentPrimary !== expectedPrimaryUrl/);
  assert.match(route, /const remaining = links\.slice\(1\)/);
  assert.match(route, /conditionalWrite/);
  assert.match(route, /syncProductLaunchNormalizedChangedItems/);
  assert.match(route, /CHINA_LINK_SHIFT_CONCURRENT_UPDATE/);
});

test("링크 상태 원장은 RLS와 서비스 역할 전용 권한을 사용한다", async () => {
  const migration = await read(
    "supabase/migrations/202608220003_product_launch_primary_link_health.sql",
  );
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all .* from anon, authenticated/is);
  assert.match(migration, /grant all .* to service_role/is);
  assert.match(migration, /product_launch_primary_link_health/);
  assert.match(migration, /where p\.archived_at is null/);
});

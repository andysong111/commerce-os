import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { moduleRegistry } from "../src/lib/moduleRegistry.ts";
import { OPS_WORKSPACE_GROUPS } from "../src/lib/opsWorkspace.ts";

const dockSource = await readFile(
  new URL("../public/product-launch-tracker-app/detail-page-dock.js", import.meta.url),
  "utf8",
);
const trackerEntry = await readFile(
  new URL("../public/product-launch-tracker-app/app.js", import.meta.url),
  "utf8",
);
const trackerCore = await readFile(
  new URL("../public/product-launch-tracker-app/lib/tracker-core.mjs", import.meta.url),
  "utf8",
);
const assetRoute = await readFile(
  new URL("../src/app/api/product-launch-tracker/detail-page-assets/route.ts", import.meta.url),
  "utf8",
);
const configRoute = await readFile(
  new URL("../src/app/api/product-launch-tracker/detail-page-engine-config/route.ts", import.meta.url),
  "utf8",
);

test("Detail Page Studio is exposed as separate SaaS and internal launch cards", () => {
  const saas = moduleRegistry.find((module) => module.id === "detail-page-studio");
  const internal = moduleRegistry.find(
    (module) => module.id === "detail-page-studio-launch-connector",
  );
  assert.equal(saas?.title, "Commerce OS Detail Page Studio · SaaS 전용");
  assert.equal(saas?.route, "https://commerce-os-detail-page-studio.vercel.app/");
  assert.equal(
    internal?.title,
    "Commerce OS Detail Page Studio · 내부 상품출시진행관리 연결본",
  );
  assert.equal(internal?.route, "/product-launch-tracker?detailPageDock=1");
  assert.ok(
    OPS_WORKSPACE_GROUPS.find((group) => group.id === "product-launch")?.moduleIds.includes(
      "detail-page-studio-launch-connector",
    ),
  );
});

test("selected launch rows run from China primary link and expose background progress controls", () => {
  assert.match(trackerEntry, /detail-page-dock\.js/);
  assert.match(dockSource, /선택 상세페이지 생성/);
  assert.match(dockSource, /primaryChinaProductLink/);
  assert.match(dockSource, /detailPageSource\?\.primaryUrl/);
  assert.match(dockSource, /ops_dock/);
  assert.match(dockSource, /source_url/);
  assert.match(dockSource, /detail-page-dock-monitor/);
  assert.match(dockSource, /실패 작업 다시 생성/);
  assert.match(dockSource, /data-retry-item/);
  assert.match(dockSource, /event\.source !== activeFrame\.contentWindow/);
  assert.match(dockSource, /event\.origin !== engineConfig\.engineOrigin/);
});

test("approved detail, main, and four supplemental assets dock to tracker fields", () => {
  assert.match(dockSource, /main_catalog: "main"/);
  assert.match(dockSource, /alternate_whole: "additional-1"/);
  assert.match(dockSource, /evidence_detail: "additional-2"/);
  assert.match(dockSource, /lifestyle_usage: "additional-3"/);
  assert.match(dockSource, /adaptive_support: "additional-4"/);
  assert.match(dockSource, /payload\.qa\?\.detailPassed !== true/);
  assert.match(dockSource, /representativeIndividualsPassed !== true/);
  assert.match(dockSource, /html: buildDetailHtml/);
  assert.match(dockSource, /detailImageUrl: docked\.detailImageUrl/);
  assert.match(dockSource, /mainImageUrl: docked\.mainImageUrl/);
  assert.match(dockSource, /additionalImageUrls: docked\.additionalImageUrls/);
  assert.match(trackerCore, /detailPageAutomation/);
  assert.match(trackerCore, /detailImageUrl/);
});

test("asset docking APIs enforce same-origin, roles, JPG, size, and public stable storage", () => {
  assert.match(assetRoute, /isSameOriginOpsRequest/);
  assert.match(assetRoute, /detail-page\|main\|additional-\[1-4\]/);
  assert.match(assetRoute, /image\\\/jpe\?g/);
  assert.match(assetRoute, /MAX_FILE_BYTES = 4_000_000/);
  assert.match(assetRoute, /product-launch-assets/);
  assert.match(assetRoute, /storage\/v1\/object\/public/);
  assert.match(configRoute, /DETAIL_PAGE_STUDIO_INTERNAL_URL/);
  assert.match(configRoute, /commerce-os-detail-page-studio\.vercel\.app/);
  assert.match(configRoute, /isSameOriginOpsRequest/);
});

test("interrupted generation is recoverable instead of remaining permanently active", () => {
  assert.match(dockSource, /browser_interrupted/);
  assert.match(dockSource, /브라우저 새로고침 또는 화면 이동으로 생성이 중단되었습니다/);
  assert.match(dockSource, /‘다시 생성’을 누르면 이어서 만들 수 있습니다/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { moduleRegistry } from "../src/lib/moduleRegistry.ts";
import { OPS_WORKSPACE_GROUPS } from "../src/lib/opsWorkspace.ts";
import {
  createDetailPageJobToken,
  verifyDetailPageJobToken,
} from "../src/lib/detailPageJobToken.ts";

const dockSource = await readFile(
  new URL("../public/product-launch-tracker-app/detail-page-dock.js", import.meta.url),
  "utf8",
);
const appShell = await readFile(
  new URL("../src/components/AppShell.tsx", import.meta.url),
  "utf8",
);
const workAssistant = await readFile(
  new URL("../src/components/OpsWorkAssistant.tsx", import.meta.url),
  "utf8",
);
const trackerPage = await readFile(
  new URL("../src/app/product-launch-tracker/page.tsx", import.meta.url),
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
const jobsRoute = await readFile(
  new URL("../src/app/api/product-launch-tracker/detail-page-jobs/route.ts", import.meta.url),
  "utf8",
);
const jobRoute = await readFile(
  new URL("../src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/route.ts", import.meta.url),
  "utf8",
);
const startRoute = await readFile(
  new URL("../src/app/api/product-launch-tracker/detail-page-jobs/[jobId]/start/route.ts", import.meta.url),
  "utf8",
);
const studioConnection = await readFile(
  new URL("../src/lib/detailPageStudioConnection.ts", import.meta.url),
  "utf8",
);
const jobServer = await readFile(
  new URL("../src/lib/detailPageJobServer.ts", import.meta.url),
  "utf8",
);
const jobToken = await readFile(
  new URL("../src/lib/detailPageJobToken.ts", import.meta.url),
  "utf8",
);
const recoveryCron = await readFile(
  new URL("../src/app/api/cron/detail-page-jobs/route.ts", import.meta.url),
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
  assert.match(dockSource, /LOCAL_BRIDGE_HEALTH_URL/);
  assert.match(dockSource, /ensureDetailPageDependencies/);
  assert.match(dockSource, /FRAME_HANDSHAKE_TIMEOUT_MS = 20 \* 1000/);
  assert.match(dockSource, /payload\.type === "ops-dock-ready"/);
  assert.match(dockSource, /studio_connection/);
});

test("detail page dependency checks stay visible and always restore the selection button", () => {
  assert.match(dockSource, /enqueueing = true;\s+enqueuePhase = "checking";\s+syncRunButton\(\);/);
  assert.match(dockSource, /연결 확인 중…/);
  assert.match(dockSource, /enqueuePhase = "registering";\s+syncRunButton\(\);/);
  assert.match(dockSource, /작업 등록 중…/);
  assert.match(
    dockSource,
    /finally \{\s+enqueueing = false;\s+enqueuePhase = "idle";\s+syncRunButton\(\);\s+\}/,
  );
  assert.match(dockSource, /toast\.hidden = false/);
  assert.match(dockSource, /toast\.hidden = true/);
  assert.match(
    dockSource,
    /!\["success", "failed", "cancelled"\]\.includes\(job\.status\)/,
  );
});

test("approved detail, main, and four supplemental assets dock to tracker fields", () => {
  assert.match(dockSource, /byRole\.get\("main_catalog"\)/);
  assert.match(dockSource, /byRole\.get\("alternate_whole"\)/);
  assert.match(dockSource, /byRole\.get\("evidence_detail"\)/);
  assert.match(dockSource, /byRole\.get\("lifestyle_usage"\)/);
  assert.match(dockSource, /byRole\.get\("adaptive_support"\)/);
  assert.match(dockSource, /action: "final_complete"/);
  assert.match(dockSource, /html: buildDetailHtml/);
  assert.match(dockSource, /detailImageUrl,/);
  assert.match(dockSource, /mainImageUrl,/);
  assert.match(dockSource, /additionalImageUrls,/);
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
  assert.match(studioConnection, /DETAIL_PAGE_STUDIO_INTERNAL_URL/);
  assert.match(studioConnection, /commerce-os-detail-page-studio\.vercel\.app/);
  assert.match(configRoute, /isSameOriginOpsRequest/);
  assert.match(configRoute, /probeDetailPageStudio/);
  assert.match(configRoute, /probeProtectedOpsCallback/);
  assert.match(studioConnection, /detail-page-callback-health/);
  assert.match(studioConnection, /OPS_PREVIEW_CALLBACK_PROTECTED/);
  assert.match(
    studioConnection,
    /commerce-os-detail-page-studio-git-agent-ops-l-6edf36-a2bsangsa\.vercel\.app/,
  );
  assert.match(studioConnection, /DETAIL_PAGE_STUDIO_AUTOMATION_BYPASS_SECRET/);
  assert.match(studioConnection, /x-vercel-set-bypass-cookie", "samesitenone"/);
  assert.match(studioConnection, /opsDockVersion !== "server-v1"/);
});

test("interrupted generation is recoverable instead of remaining permanently active", () => {
  assert.match(dockSource, /executionMode: "server-v1"/);
  assert.match(dockSource, /await syncJobs\(\)/);
  assert.match(dockSource, /sourceRunId: job\.sourceRunId/);
  assert.match(dockSource, /job\.status === "render_pending"/);
  assert.match(dockSource, /화면 종료 가능/);
  assert.match(dockSource, /finalizerRetryAt\.set\(jobId, Date\.now\(\) \+ 30_000\)/);
  assert.doesNotMatch(dockSource, /browser_interrupted/);
});

test("OPS-wide work assistant survives route changes and owns the persistent browser worker", () => {
  assert.match(appShell, /OpsWorkAssistant/);
  assert.match(workAssistant, /실시간 작업 도우미/);
  assert.match(workAssistant, /현재 진행 중인 작업/);
  assert.match(workAssistant, /detail_page_mode=worker/);
  assert.match(workAssistant, /POLL_MS = 2_500/);
  assert.match(workAssistant, /visibleJobs\.map/);
  assert.match(workAssistant, /retry-detail-page-job/);
  assert.match(workAssistant, /detailPageItem=/);
  assert.match(trackerPage, /detail_page_mode: "client"/);
  assert.match(dockSource, /DETAIL_PAGE_MODE/);
  assert.match(dockSource, /CAN_REGISTER_JOBS/);
  assert.match(dockSource, /CAN_EXECUTE_JOBS/);
  assert.match(dockSource, /startClientSync/);
  assert.match(dockSource, /queueCollectingJobsFromState/);
  assert.match(dockSource, /retryingItems\.has/);
  assert.match(dockSource, /runButton\.disabled = count === 0 \|\| enqueueing/);
  assert.match(dockSource, /markLegacyFailed: synced/);
  assert.match(dockSource, /event\.source !== window\.parent/);
  assert.match(dockSource, /event\.key !== STORAGE_KEY/);
});

test("durable jobs reuse the deployed job ledger and require a signed per-job worker token", () => {
  assert.match(jobServer, /product_launch_upload_jobs/);
  assert.match(jobServer, /payload\.kind/);
  assert.match(jobToken, /createHmac\("sha256"/);
  assert.match(jobsRoute, /request_id: `detail-page:/);
  assert.match(jobRoute, /verifyDetailPageJobToken/);
  assert.match(jobRoute, /action === "claim"/);
  assert.match(jobRoute, /action === "evidence_ready"/);
  assert.match(jobRoute, /action === "final_complete"/);
  assert.match(jobRoute, /const releasesLease = action !== "progress"/);
  assert.doesNotMatch(jobRoute, /workerToken:/);
  assert.match(studioConnection, /\/api\/internal\/ops-detail-page-job/);
  assert.match(startRoute, /resolveDetailPageStudioConnection/);
  assert.match(startRoute, /buildProtectedOpsCallbackUrl/);
  assert.match(startRoute, /redirect: "manual"/);
  const config = { supabaseUrl: "https://example.supabase.co", secretKey: "test-secret" };
  const token = createDetailPageJobToken(
    config,
    "0c23a96b-1cda-44b6-9c08-1fa1c1b45a36",
    "00112233-4455-4677-8899-aabbccddeeff",
  );
  assert.equal(token.length, 64);
  assert.equal(
    verifyDetailPageJobToken(
      config,
      "0c23a96b-1cda-44b6-9c08-1fa1c1b45a36",
      "00112233-4455-4677-8899-aabbccddeeff",
      token,
    ),
    true,
  );
  assert.equal(
    verifyDetailPageJobToken(
      config,
      "0c23a96b-1cda-44b6-9c08-1fa1c1b45a36",
      "00112233-4455-4677-8899-aabbccddeeff",
      "0".repeat(64),
    ),
    false,
  );
});

test("stalled server generation is restarted by the production watchdog", () => {
  assert.match(recoveryCron, /RECOVERY_AFTER_MS = 8 \* 60 \* 1000/);
  assert.match(recoveryCron, /listRecoverableDetailPageJobs/);
  assert.match(recoveryCron, /CRON_SECRET/);
  assert.match(recoveryCron, /createDetailPageJobToken/);
});

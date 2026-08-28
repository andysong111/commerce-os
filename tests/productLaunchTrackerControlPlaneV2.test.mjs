import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("Product Master v2 is core-first and hands OPS UI a verified full first page", () => {
  const app = read("public/product-launch-tracker-app/app.js");
  const controlPlane = read("public/product-launch-tracker-app/product-master-control-plane.js");
  const gate = read("public/product-launch-tracker-app/workflow-ui-gate.js");
  assert.match(app, /productLaunchArchitecture = "v2-core-first"/);
  assert.match(app, /detail-page-jobs\/active/);
  assert.match(app, /installLazyDetailPageIntegrations/);
  assert.match(app, /button\[data-action='detail'\]/);
  assert.match(app, /workflow-ui-gate\.js/);
  assert.match(app, /installWorkflowUiGate/);
  assert.doesNotMatch(app, /await import\("\.\/optimized-app\.js"\)/);
  assert.match(controlPlane, /MASTER_FALLBACK_DELAY_MS = 0/);

  assert.match(gate, /WORKFLOW_API = "\/api\/product-launch-tracker\/recovery-page"/);
  assert.match(gate, /INITIAL_WORKFLOW_PAGE_SIZE = 25/);
  assert.match(gate, /unfinishedOnly: "true"/);
  assert.match(gate, /PROBE_TIMEOUT_MS = 5_000/);
  assert.match(gate, /Array\.isArray\(body\?\.items\)/);
  assert.match(gate, /installWarmWorkflowPage/);
  assert.match(gate, /X-Commerce-Workflow-Warm-Handoff/);
  assert.match(gate, /optimizedAppPromise = import\("\.\/optimized-app\.js"\)/);
  assert.match(gate, /IDLE_RETRY_MS = 5_000/);

  const standalone = app.split("} else {")[1] ?? "";
  const beforeLazyInstaller = standalone.split("function installLazyDetailPageIntegrations")[0] ?? "";
  assert.doesNotMatch(beforeLazyInstaller, /await import\("\.\/detail-page-dock\.js"\)/);
});

test("Supabase REST 장애 중에도 최근 정상 OPS 캐시가 있는 Product Master 행은 SEO 선택을 허용한다", () => {
  const app = read("public/product-launch-tracker-app/app.js");
  const fallback = read("public/product-launch-tracker-app/seo-fallback-cache-selection.js");

  assert.match(app, /await import\("\.\/seo-fallback-cache-selection\.js"\)/);
  assert.match(fallback, /MAX_CACHE_AGE_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(fallback, /tr\.master-core-fallback-row/);
  assert.match(fallback, /checkbox\.classList\.add\("row-check"\)/);
  assert.match(fallback, /checkbox\.disabled = false/);
  assert.match(fallback, /row\.dataset\.id/);
  assert.match(fallback, /NORMALIZED_ITEM_PATH/);
  assert.match(fallback, /browser-last-known-good-cache/);
  assert.match(fallback, /document\.body\.dataset\.productMasterFallback === "true"/);
});

test("global work assistant does not poll the full detail job list every 2.5 seconds", () => {
  const assistant = read("src/components/OpsWorkAssistant.tsx");
  assert.match(assistant, /ACTIVE_JOBS_API = "\/api\/product-launch-tracker\/detail-page-jobs\/active"/);
  assert.match(assistant, /ACTIVE_POLL_MS = 5_000/);
  assert.match(assistant, /IDLE_POLL_MS = 30_000/);
  assert.match(assistant, /HIDDEN_POLL_MS = 60_000/);
  assert.match(assistant, /refreshDetailActivity/);
  assert.doesNotMatch(assistant, /const POLL_MS = 2_500/);
  assert.doesNotMatch(assistant, /setInterval\(\(\) => void refreshAll\(\), POLL_MS\)/);
});

test("idle worker probe reads at most one active detail job without selecting payloads", () => {
  const route = read("src/app/api/product-launch-tracker/detail-page-jobs/active/route.ts");
  assert.match(route, /select: "id,updated_at"/);
  assert.match(route, /status: "in\.\(queued,running\)"/);
  assert.match(route, /limit: "1"/);
  assert.match(route, /ACTIVE_PROBE_REVALIDATE_SECONDS = 20/);
  assert.doesNotMatch(route, /select: "\*"/);
});

test("active detail job probe has a dedicated partial index migration", () => {
  const migration = read("supabase/migrations/202608170003_detail_page_active_probe_index.sql");
  assert.match(migration, /product_launch_upload_jobs_detail_active_owner_status_idx/);
  assert.match(migration, /owner_id, status, updated_at desc/);
  assert.match(migration, /payload ->> 'kind'\) = 'detail_page'/);
  assert.match(migration, /status in \('queued', 'running'\)/);
});

const pageParams = new URLSearchParams(window.location.search);
const detailPageMode = pageParams.get("detail_page_mode") || "standalone";
const dockEventSource = "commerce-os-detail-page-dock";
const workAssistantSource = "commerce-os-work-assistant";
const detailJobsApi = "/api/product-launch-tracker/detail-page-jobs";
const workerIdleCheckMs = 30_000;

function signalDetailPageWorkerReady() {
  window.parent?.postMessage(
    {
      source: dockEventSource,
      type: "detail-page-worker-ready",
    },
    window.location.origin,
  );
}

if (detailPageMode === "worker") {
  let workerModulesPromise = null;
  let workerCheckTimer = null;

  const ensureWorkerModules = () => {
    if (!workerModulesPromise) {
      workerModulesPromise = (async () => {
        await import("./detail-page-product-scope.js");
        await import("./detail-page-dock.js");
        await import("./detail-page-bgrade-main-only-dock.js");
        await import("./detail-page-dock-repair.js");
      })();
    }
    return workerModulesPromise;
  };

  const scheduleWorkerCheck = (delay = 800) => {
    window.clearTimeout(workerCheckTimer);
    workerCheckTimer = window.setTimeout(async () => {
      if (workerModulesPromise) return;
      try {
        const response = await fetch(detailJobsApi, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        });
        const payload = await response.json().catch(() => ({}));
        const hasActiveJob =
          response.ok &&
          payload?.ok === true &&
          Array.isArray(payload.jobs) &&
          payload.jobs.some(
            (job) =>
              !["success", "failed", "cancelled"].includes(
                String(job?.status || ""),
              ),
          );
        if (hasActiveJob) {
          await ensureWorkerModules();
          return;
        }
      } catch {
        // The shared jobs cache may be unavailable while Supabase is overloaded.
      }
      scheduleWorkerCheck(workerIdleCheckMs);
    }, delay);
  };

  signalDetailPageWorkerReady();
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    const payload = event.data;
    if (payload?.source !== workAssistantSource) return;
    if (payload?.type === "detail-page-worker-ping") {
      signalDetailPageWorkerReady();
      return;
    }
    if (payload?.__commerceWorkerBootstrapForwarded === true) return;
    if (
      payload?.type !== "activate-detail-page-job" &&
      payload?.type !== "retry-detail-page-job"
    ) {
      return;
    }

    void ensureWorkerModules().then(() => {
      const forwarded = {
        ...payload,
        __commerceWorkerBootstrapForwarded: true,
      };
      window.dispatchEvent(
        new MessageEvent("message", {
          data: forwarded,
          origin: window.location.origin,
          source: window.parent,
        }),
      );
    });
  });
  scheduleWorkerCheck();
} else {
  try {
    const startupPreview = await import("./startup-page-cache-preview.js");
    startupPreview.installStartupPageCachePreview?.();
  } catch (error) {
    console.error("Product launch startup cache preview failed", error);
  }

  // Do not abort or replace the list request. If a cold start is slow, only show a
  // passive status message while the existing optimized app keeps waiting normally.
  const slowListTimer = window.setTimeout(() => {
    const status = document.querySelector("#save-status");
    if (status?.textContent === "불러오는 중") {
      status.textContent = "목록 응답 지연 · 서버 응답을 기다리는 중";
    }
  }, 8_000);
  try {
    // The optimized app owns list loading, paging, lazy details and item-scoped saves.
    await import("./optimized-app.js");
  } finally {
    window.clearTimeout(slowListTimer);
  }
  // Optimized tracker owns the active detail dialog, so B-code China purchasing
  // metadata must mount on that path rather than the retired legacy extension.
  await import("./optimized-china-order-mapping.js");
  // Product Master is the authority for which B-codes actually belong to a model.
  // Remove stale or cross-model option rows before the operator edits or saves them.
  await import("./model-bcode-option-guard.js");
  // The China-option panel must always mirror the B-codes that are actually visible
  // in the order/receipt option-price table. Blank and stale rows are never shown.
  await import("./china-option-table-authority.js");
  // Every successful purchase-metadata save is copied to Product Master so that its
  // latest-value ledger reflects whichever side — launch tracker or order Draft —
  // the operator edited last.
  await import("./purchase-metadata-auto-sync.js");

  // Lightweight table and dialog behavior is available immediately after first render.
  await import("./table-horizontal-scroll.js");
  await import("./dialog-close-fix.js");
  await import("./table-inline-ops-loader.js");
  await import("./table-frozen-columns-fix.js");
  await import("./detail-page-product-scope.js");
  await import("./detail-page-dock.js");
  await import("./detail-page-bgrade-main-only-dock.js");
  await import("./detail-page-dock-repair.js");
  await import("./detail-page-option-guard.js");
  await import("./empty-cell-placeholder-cleanup.js");
  await import("./shopling-upload-ui.js");
  await import("./product-launch-flow-handoff.js");

  // Network-heavy and rarely used category integrations wait until the browser is idle.
  scheduleIdleIntegrations();
}

function scheduleIdleIntegrations() {
  let started = false;
  const eagerStart = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest(
        "#bulk-apply-button, #export-menu-button, #policy-button, button[data-action='detail'], button[data-action='preview']",
      )
    ) {
      start();
    }
  };
  const start = () => {
    if (started) return;
    started = true;
    document.removeEventListener("pointerdown", eagerStart, true);
    void loadIdleIntegrations();
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(start, { timeout: 1_200 });
  } else {
    window.setTimeout(start, 250);
  }
  document.addEventListener("pointerdown", eagerStart, true);
}

async function loadIdleIntegrations() {
  const modules = [
    "./category-ai.js",
    "./category-ai-reliable.js",
    "./category-review-queue-link.js",
    "./category-toolbar-layout.js",
    "./category-local-upload-payload.js",
    "./category-local-health-recovery.js",
    "./category-local-update.js",
    "./category-local-result-recovery.js",
    "./category-update-progress.js",
    "./category-update-cancel-guard.js",
    "./category-update-work-assistant-bridge.js",
  ];
  for (const path of modules) {
    try {
      await import(path);
    } catch (error) {
      console.error(`Product launch integration failed to load: ${path}`, error);
    }
  }
}

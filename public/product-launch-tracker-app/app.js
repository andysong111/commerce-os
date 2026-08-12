const pageParams = new URLSearchParams(window.location.search);
const detailPageMode = pageParams.get("detail_page_mode") || "standalone";
const dockEventSource = "commerce-os-detail-page-dock";
const workAssistantSource = "commerce-os-work-assistant";

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
  await import("./detail-page-product-scope.js");
  await import("./detail-page-dock.js");
  await import("./detail-page-bgrade-main-only-dock.js");
  await import("./detail-page-dock-repair.js");
  signalDetailPageWorkerReady();
  window.addEventListener("message", (event) => {
    if (event.source !== window.parent || event.origin !== window.location.origin) return;
    if (
      event.data?.source === workAssistantSource &&
      event.data?.type === "detail-page-worker-ping"
    ) {
      signalDetailPageWorkerReady();
    }
  });
} else {
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

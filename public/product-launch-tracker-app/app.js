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
  await import("./detail-page-dock.js");
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
  await import("./tracker-seed-model-migrations.js");
  await import("./tracker-deleted-seed-filter.js");
  await import("./single-option-barcode-sync.js");
  await import("./bootstrap.js");
  await import("./selected-row-delete.js");
  await import("./single-row-add.js");
  await import("./single-row-add-barcode-guard.js");
  await import("./product-launch-flow-batch-handoff.js");
  await import("./table-horizontal-scroll.js");
  await import("./dialog-close-fix.js");
  await import("./product-launch-flow-handoff.js");
  await import("./relaunch-reset-fixed.js");
  await import("./china-product-links.js");
  await import("./table-inline-ops-loader.js");
  await import("./inline-options-focus-guard.js");
  await import("./inline-identity-editors.js");
  await import("./option-location-inline-editor.js");
  await import("./multi-option-main-barcode-visibility.js");
  await import("./inline-save-no-flicker.js");
  await import("./category-ai.js");
  await import("./category-ai-reliable.js");
  await import("./category-review-queue-link.js");
  await import("./category-toolbar-layout.js");
  await import("./category-local-update.js");
  await import("./category-local-result-recovery.js");
  await import("./category-update-progress.js");
  await import("./category-update-cancel-guard.js");
  await import("./category-update-work-assistant-bridge.js");
  await import("./detail-page-dock.js");
  await import("./detail-page-option-guard.js");
  await import("./empty-cell-placeholder-cleanup.js");
}

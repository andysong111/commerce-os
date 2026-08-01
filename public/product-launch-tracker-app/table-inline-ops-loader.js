const NativeMutationObserver = window.MutationObserver;
const tableHead = document.querySelector("#launch-table-head");
const tableBody = document.querySelector("#launch-table-body");
const suppressedTargets = new Set([tableHead, tableBody].filter(Boolean));

window.MutationObserver = class TableOpsImportMutationObserver extends NativeMutationObserver {
  observe(target, options) {
    if (suppressedTargets.has(target)) return;
    return super.observe(target, options);
  }
};

try {
  await import("./table-inline-ops.js");
} finally {
  window.MutationObserver = NativeMutationObserver;
}

let refreshQueued = false;
const safeObserver = new NativeMutationObserver(() => {
  if (refreshQueued) return;
  refreshQueued = true;
  safeObserver.disconnect();
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new Event("resize"));
    window.requestAnimationFrame(() => {
      refreshQueued = false;
      observeTables();
    });
  });
});

function observeTables() {
  if (tableHead) safeObserver.observe(tableHead, { childList: true, subtree: true });
  if (tableBody) safeObserver.observe(tableBody, { childList: true, subtree: true });
}

observeTables();

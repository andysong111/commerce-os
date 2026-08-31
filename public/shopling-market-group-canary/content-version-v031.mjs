(() => {
  "use strict";
  const PANEL_ID = "commerce-os-shopling-market-fresh-worker-panel";
  function sync() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    for (const child of panel.children) {
      const value = String(child.textContent || "");
      if (value.includes("Commerce OS · Fresh Worker Canary v0.3.0")) {
        child.textContent = value.replace("v0.3.0", "v0.3.1");
        break;
      }
    }
  }
  sync();
  new MutationObserver(sync).observe(document.documentElement, { childList: true, subtree: true });
})();

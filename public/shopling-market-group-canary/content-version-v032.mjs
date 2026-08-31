(() => {
  "use strict";
  const PANEL_ID = "commerce-os-shopling-market-fresh-worker-panel";
  const DISPLAY_VERSION = "0.3.2";
  function sync() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    for (const child of panel.children) {
      const value = String(child.textContent || "");
      if (value.includes("Commerce OS · Fresh Worker Canary v0.3.0") || value.includes("Commerce OS · Fresh Worker Canary v0.3.1")) {
        child.textContent = value
          .replace("v0.3.0", `v${DISPLAY_VERSION}`)
          .replace("v0.3.1", `v${DISPLAY_VERSION}`);
        break;
      }
    }
  }
  sync();
  new MutationObserver(sync).observe(document.documentElement, { childList: true, subtree: true });
})();

(() => {
  "use strict";
  const PANEL_ID = "commerce-os-shopling-market-parallel-worker-panel";
  const DISPLAY_VERSION = "0.3.4";
  function sync() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    for (const child of panel.children) {
      const value = String(child.textContent || "");
      if (/Commerce OS · Parallel Fresh Worker Canary v0\.3\.4/.test(value)) {
        child.textContent = `Commerce OS · Parallel Fresh Worker Canary v${DISPLAY_VERSION}`;
        break;
      }
    }
    const guide = [...panel.children].find((child) => String(child.textContent || "").includes("원본 A18 유지"));
    if (guide) guide.textContent = "원본 A18 유지 → 도매/소매 남은 채널별 A18 복제창 동시 생성 → 각 창 독립 처리";
  }
  sync();
  new MutationObserver(sync).observe(document.documentElement, { childList: true, subtree: true });
})();

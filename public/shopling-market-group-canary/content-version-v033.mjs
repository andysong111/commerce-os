(() => {
  "use strict";
  const PANEL_ID = "commerce-os-shopling-market-fresh-worker-panel";
  const DISPLAY_VERSION = "0.3.3";
  function sync() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    for (const child of panel.children) {
      const value = String(child.textContent || "");
      if (/Commerce OS · Fresh Worker Canary v0\.3\.[0-2]/.test(value)) {
        child.textContent = value.replace(/v0\.3\.[0-2]/, `v${DISPLAY_VERSION}`);
        break;
      }
    }
    const guide = [...panel.children].find((child) => String(child.textContent || "").includes("채널 1건 완료"));
    if (guide) guide.textContent = "원본 A18 유지 → A18 복제 작업창 1개 → 채널 1건 → 성공 후 복제본 폐기 → 다시 A18 복제";
  }
  sync();
  new MutationObserver(sync).observe(document.documentElement, { childList: true, subtree: true });
})();

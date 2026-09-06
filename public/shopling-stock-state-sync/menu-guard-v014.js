(() => {
  const VERSION = "0.1.4";
  const MAIN_ALERT_EVENT = "commerce-os-stock-main-alert";
  const PERMISSION_DENIED = /(?:페이지\s*)?접근\s*권한이\s*없습니다|접근권한이\s*없습니다|권한이\s*없습니다/i;
  let permissionDenied = false;
  let lastPermissionSignature = "";

  const norm = (value) =>
    String(value ?? "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim();

  async function failActiveJob(message) {
    const response = await chrome.runtime
      .sendMessage({ type: "STOCK_SYNC_GET_STATUS", version: VERSION })
      .catch(() => null);
    const active = response?.active;
    if (!active || active.status !== "RUNNING" || !active.job?.jobId || !active.stage) return;
    if (String(active.stage) === "WAIT_A21_RESULT") return;
    const signature = `${active.job.jobId}:${active.stage}:${location.href}:${message}`;
    if (signature === lastPermissionSignature) return;
    lastPermissionSignature = signature;
    await chrome.runtime
      .sendMessage({
        type: "STOCK_SYNC_STEP_RESULT",
        jobId: active.job.jobId,
        stage: active.stage,
        result: {
          ok: false,
          code: "SHOPLING_PERMISSION_DENIED",
          message: `Shopling 접근권한 차단 감지: ${message}`,
          evidence: {
            href: String(location.href || ""),
            title: String(document.title || ""),
            guardVersion: VERSION,
            permissionDenied,
          },
        },
        page: {
          role: "OTHER",
          href: String(location.href || ""),
          title: String(document.title || ""),
          top: window.top === window,
          canNavigate: false,
          permissionDenied: true,
        },
        version: VERSION,
      })
      .catch(() => null);
  }

  // v0.1.3 intercepted document.querySelectorAll and could hide the real
  // [6] 옵션대량수정 menu from the automator. v0.1.4 deliberately does not
  // rewrite Shopling DOM queries. Safety is kept by exact menu-name matching
  // in content-shopling-v013.js plus fail-closed permission/error handling.
  window.addEventListener(MAIN_ALERT_EVENT, (event) => {
    const message = norm(event?.detail?.message);
    if (!PERMISSION_DENIED.test(message)) return;
    permissionDenied = true;
    void failActiveJob(message);
  });
})();
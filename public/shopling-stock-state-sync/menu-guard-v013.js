(() => {
  const VERSION = "0.1.3";
  const MENU_QUERY = "a,[onclick],li,td,span,div";
  const MAIN_ALERT_EVENT = "commerce-os-stock-main-alert";
  const BLOCKED_ROUTE = /prodBulkOptLst\.phtml/i;
  const PERMISSION_DENIED = /(?:페이지\s*)?접근\s*권한이\s*없습니다|접근권한이\s*없습니다|권한이\s*없습니다/i;
  let permissionDenied = false;
  let lastPermissionSignature = "";

  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const compact = (value) => norm(value).replace(/\s+/g, "").replace(/[·•]/g, "");

  function visible(element) {
    if (!(element instanceof HTMLElement)) return true;
    const rect = element.getBoundingClientRect();
    return element.offsetParent !== null || rect.width > 0 || rect.height > 0;
  }

  function stageForLabel(value) {
    const label = compact(value);
    if (/^(?:\[?A?4\]?[:.\-]?)?상품조회수정$/i.test(label)) return "A4";
    if (/^(?:\[?A?6\]?[:.\-]?)?옵션대량수정$/i.test(label)) return "A6";
    if (/^(?:\[?A?21\]?[:.\-]?)?쇼핑몰상품수정$/i.test(label)) return "A21_LIST";
    return null;
  }

  function routeSignature(element) {
    const href = norm(element.getAttribute?.("href"));
    const onclick = norm(element.getAttribute?.("onclick"));
    return `${href}||${onclick}`;
  }

  function routeBlocked(element) {
    return BLOCKED_ROUTE.test(routeSignature(element));
  }

  function safeMenuTargets(originalQuery) {
    if (permissionDenied) return [];
    const raw = [...originalQuery.call(document, "a,[onclick]")]
      .filter(visible)
      .filter((element) => stageForLabel(element.textContent))
      .filter((element) => !routeBlocked(element));

    const byStage = new Map();
    for (const element of raw) {
      const stage = stageForLabel(element.textContent);
      if (!stage) continue;
      const signature = routeSignature(element);
      if (!signature || signature === "||") continue;
      const group = byStage.get(stage) || new Map();
      if (!group.has(signature)) group.set(signature, element);
      byStage.set(stage, group);
    }

    const safe = [];
    for (const group of byStage.values()) {
      if (group.size !== 1) continue;
      safe.push([...group.values()][0]);
    }
    return safe;
  }

  const originalQuerySelectorAll = document.querySelectorAll;
  document.querySelectorAll = function commerceOsSafeQuerySelectorAll(selector) {
    if (String(selector) !== MENU_QUERY) return originalQuerySelectorAll.call(this, selector);
    return safeMenuTargets(originalQuerySelectorAll);
  };

  async function failActiveJob(message) {
    const response = await chrome.runtime.sendMessage({ type: "STOCK_SYNC_GET_STATUS", version: VERSION }).catch(() => null);
    const active = response?.active;
    if (!active || active.status !== "RUNNING" || !active.job?.jobId || !active.stage) return;
    if (String(active.stage) === "WAIT_A21_RESULT") return;
    const signature = `${active.job.jobId}:${active.stage}:${location.href}:${message}`;
    if (signature === lastPermissionSignature) return;
    lastPermissionSignature = signature;
    await chrome.runtime.sendMessage({
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
    }).catch(() => null);
  }

  window.addEventListener(MAIN_ALERT_EVENT, (event) => {
    const message = norm(event?.detail?.message);
    if (!PERMISSION_DENIED.test(message)) return;
    permissionDenied = true;
    void failActiveJob(message);
  });
})();
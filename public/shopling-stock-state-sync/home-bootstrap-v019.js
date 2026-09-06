(() => {
  const VERSION = "0.1.9";
  const STATE_KEY = "commerceOsShoplingStockStateSyncV013";
  const MAIN_REQUEST = "commerce-os-stock-main-click";
  const MAIN_TOKEN_ATTRIBUTE = "data-commerce-os-stock-click-token";
  const TARGET_STAGES = new Set(["A6", "A4", "A21_LIST"]);
  const BOOTSTRAP_LIMIT_MS = 12_000;
  const POLL_MS = 250;

  if (window.top !== window) return;

  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const compact = (value) => norm(value).replace(/\s+/g, "").replace(/[·•]/g, "");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let bootKey = "";

  function visible(element) {
    if (!(element instanceof HTMLElement)) return true;
    const rect = element.getBoundingClientRect();
    return element.offsetParent !== null || rect.width > 0 || rect.height > 0;
  }

  function stagePattern(stage) {
    if (stage === "A4") return /(?:\[?A?4\]?[:.\-]?\s*)?상품조회수정/i;
    if (stage === "A6") return /(?:\[?A?6\]?[:.\-]?\s*)?옵션대량수정/i;
    if (stage === "A21_LIST") return /(?:\[?A?21\]?[:.\-]?\s*)?쇼핑몰상품수정/i;
    return /$a/;
  }

  function clickableByPattern(pattern, maxLength = 80) {
    const candidates = [...document.querySelectorAll("a,[onclick],li,td,span,div")]
      .filter((element) => {
        if (!visible(element)) return false;
        const value = norm(element.textContent);
        return Boolean(value && value.length <= maxLength && pattern.test(value));
      });
    candidates.sort((left, right) => {
      const leftClickable = left.matches("a,[onclick]") ? 0 : 1;
      const rightClickable = right.matches("a,[onclick]") ? 0 : 1;
      return leftClickable - rightClickable || norm(left.textContent).length - norm(right.textContent).length;
    });
    const target = candidates[0] || null;
    return target?.closest("a,[onclick]") || target;
  }

  function stageMenuTarget(stage) {
    return clickableByPattern(stagePattern(stage));
  }

  function productRootTarget() {
    const candidates = [...document.querySelectorAll("a,[onclick],li,td,span,div")]
      .filter((element) => visible(element))
      .filter((element) => {
        const value = compact(element.textContent || "");
        return /^\[A\]상품$/i.test(value) || /^A상품$/i.test(value);
      });
    candidates.sort((left, right) => {
      const leftClickable = left.matches("a,[onclick]") ? 0 : 1;
      const rightClickable = right.matches("a,[onclick]") ? 0 : 1;
      return leftClickable - rightClickable || compact(left.textContent).length - compact(right.textContent).length;
    });
    const target = candidates[0] || null;
    return target?.closest("a,[onclick]") || target;
  }

  function page(stage) {
    return {
      role: "OTHER",
      href: String(location.href || ""),
      title: String(document.title || ""),
      top: true,
      canNavigate: Boolean(stageMenuTarget(stage)),
      productRootVisible: Boolean(productRootTarget()),
      bootstrapVersion: VERSION,
    };
  }

  async function activeState() {
    const response = await chrome.runtime.sendMessage({ type: "STOCK_SYNC_GET_STATUS", version: VERSION }).catch(() => null);
    return response?.active || null;
  }

  async function sendNavigating(active) {
    await chrome.runtime.sendMessage({
      type: "STOCK_SYNC_STEP_RESULT",
      jobId: active.job.jobId,
      stage: active.stage,
      result: {
        ok: false,
        navigating: true,
        code: "SHOPLING_PRODUCT_ROOT_NAVIGATING",
        message: `Shopling [A]상품 상위메뉴 진입 중 · ${active.stage} 자동 이동 준비`,
        evidence: { href: String(location.href || ""), bootstrapVersion: VERSION },
      },
      page: page(active.stage),
      version: VERSION,
    }).catch(() => null);
  }

  async function sendReady(active) {
    await chrome.runtime.sendMessage({
      type: "STOCK_SYNC_PAGE_READY",
      page: page(active.stage),
      version: VERSION,
    }).catch(() => null);
  }

  async function failIfStillCurrent(active) {
    const latest = await activeState();
    if (
      !latest ||
      latest.status !== "RUNNING" ||
      latest.job?.jobId !== active.job?.jobId ||
      latest.stage !== active.stage
    ) return;
    await chrome.runtime.sendMessage({
      type: "STOCK_SYNC_STEP_RESULT",
      jobId: active.job.jobId,
      stage: active.stage,
      result: {
        ok: false,
        code: "SHOPLING_PRODUCT_MENU_BOOTSTRAP_FAILED",
        message: `Shopling [A]상품 상위메뉴 또는 ${active.stage} 대상 메뉴를 ${Math.round(BOOTSTRAP_LIMIT_MS / 1000)}초 안에 찾지 못했습니다.`,
        evidence: {
          href: String(location.href || ""),
          title: String(document.title || ""),
          productRootVisible: Boolean(productRootTarget()),
          targetMenuVisible: Boolean(stageMenuTarget(active.stage)),
          bootstrapVersion: VERSION,
        },
      },
      page: page(active.stage),
      version: VERSION,
    }).catch(() => null);
  }

  async function bootstrap(active) {
    if (!active || active.status !== "RUNNING" || !TARGET_STAGES.has(String(active.stage || ""))) return;
    if (!active.job?.jobId) return;
    const key = `${active.job.jobId}:${active.stage}:${location.href}`;
    if (key === bootKey) return;
    bootKey = key;

    if (stageMenuTarget(active.stage)) {
      await sendReady(active);
      return;
    }

    const deadline = Date.now() + BOOTSTRAP_LIMIT_MS;
    let rootClicked = false;
    while (Date.now() < deadline) {
      if (stageMenuTarget(active.stage)) {
        await sendReady(active);
        return;
      }
      const root = productRootTarget();
      if (root && !rootClicked) {
        rootClicked = true;
        const token = `stock-root-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        root.setAttribute(MAIN_TOKEN_ATTRIBUTE, token);
        window.dispatchEvent(new CustomEvent(MAIN_REQUEST, { detail: { token } }));
        await sendNavigating(active);
      }
      await sleep(POLL_MS);
    }
    await failIfStillCurrent(active);
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes?.[STATE_KEY]) return;
    const active = changes[STATE_KEY].newValue || null;
    if (!active) {
      bootKey = "";
      return;
    }
    void bootstrap(active);
  });

  void activeState().then((active) => bootstrap(active));
})();
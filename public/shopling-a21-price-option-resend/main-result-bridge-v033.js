(() => {
  const VERSION = "0.3.3";
  const COMPLETE_EVENT = "commerce-os-a21-v033-result-complete";
  const children = new Set();
  const signaled = new WeakSet();
  const originalOpen = window.open.bind(window);
  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

  function autoScrollDocument(doc, child) {
    try {
      const root = doc.scrollingElement || doc.documentElement || doc.body;
      const height = Math.max(
        Number(root?.scrollHeight || 0),
        Number(doc.documentElement?.scrollHeight || 0),
        Number(doc.body?.scrollHeight || 0),
      );
      if (root && height > 0) root.scrollTop = height;
      if (height > 0 && typeof child.scrollTo === "function") child.scrollTo(0, height);
      const candidates = [doc.documentElement, doc.body, ...doc.querySelectorAll("div,main,section,article,table,tbody")];
      for (const node of candidates) {
        if (!node) continue;
        const scrollHeight = Number(node.scrollHeight || 0);
        const clientHeight = Number(node.clientHeight || 0);
        if (scrollHeight > clientHeight + 24) node.scrollTop = scrollHeight;
      }
    } catch {
      // Cross-origin / navigation transition. Keep polling until the Shopling result document is readable.
    }
  }

  function inspectChild(child) {
    if (!child || child.closed || signaled.has(child)) return false;
    try {
      const doc = child.document;
      if (!doc) return false;
      autoScrollDocument(doc, child);
      const text = norm(doc.body?.innerText || doc.body?.textContent || doc.documentElement?.innerText || "");
      const completion = /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text)
        || /상품\s*수정\s*전송\s*완료/i.test(text);
      const processing = /처리중입니다/i.test(text)
        || /잠시만\s*기다려주시기\s*바랍니다/i.test(text);
      if (!completion || processing) return false;
      signaled.add(child);
      document.dispatchEvent(new CustomEvent(COMPLETE_EVENT, {
        detail: JSON.stringify({
          version: VERSION,
          href: String(child.location?.href || ""),
          title: String(doc.title || ""),
          completion: true,
          processing: false,
        }),
      }));
      return true;
    } catch {
      return false;
    }
  }

  function track(child) {
    if (!child) return child;
    children.add(child);
    return child;
  }

  window.open = function commerceOsA21WindowOpen(...args) {
    return track(originalOpen(...args));
  };

  try { Object.defineProperty(window.open, "name", { value: "open" }); } catch { /* no-op */ }

  setInterval(() => {
    for (const child of [...children]) {
      if (!child || child.closed) {
        children.delete(child);
        continue;
      }
      inspectChild(child);
    }
  }, 400);
})();

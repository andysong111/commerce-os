(() => {
  if (window.__commerceOsA21ResultBridgeV034Installed) return;
  window.__commerceOsA21ResultBridgeV034Installed = true;

  const VERSION = "0.3.4";
  const COMPLETE_EVENT = "commerce-os-a21-v034-result-complete";
  const tracked = new Set();
  const signaled = new WeakSet();
  const originalOpen = window.open.bind(window);
  const nativeSubmit = HTMLFormElement.prototype.submit;
  const nativeRequestSubmit = HTMLFormElement.prototype.requestSubmit;
  const formTargets = new WeakMap();
  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

  let captureUntil = 0;
  let lastSubmitAt = 0;
  let lastSubmitReturn;
  let lastOpenedChild = null;
  let lastOpenedAt = 0;
  let targetSeq = 0;

  const captureActive = () => Date.now() < captureUntil;

  function track(child) {
    if (!child) return child;
    tracked.add(child);
    lastOpenedChild = child;
    lastOpenedAt = Date.now();
    return child;
  }

  function autoScrollDocument(doc, win) {
    try {
      const root = doc.scrollingElement || doc.documentElement || doc.body;
      const height = Math.max(
        Number(root?.scrollHeight || 0),
        Number(doc.documentElement?.scrollHeight || 0),
        Number(doc.body?.scrollHeight || 0),
      );
      if (root && height > 0) root.scrollTop = height;
      if (height > 0 && typeof win?.scrollTo === "function") win.scrollTo(0, height);
      const candidates = [doc.documentElement, doc.body, ...doc.querySelectorAll("div,main,section,article,table,tbody")];
      for (const node of candidates) {
        if (!node) continue;
        const scrollHeight = Number(node.scrollHeight || 0);
        const clientHeight = Number(node.clientHeight || 0);
        if (scrollHeight > clientHeight + 16) node.scrollTop = scrollHeight;
      }
    } catch {
      // Navigation/cross-origin transition: keep polling until readable again.
    }
  }

  function signalComplete(child, href, title) {
    if (!child || signaled.has(child)) return;
    signaled.add(child);
    document.dispatchEvent(new CustomEvent(COMPLETE_EVENT, {
      detail: JSON.stringify({
        version: VERSION,
        href: String(href || ""),
        title: String(title || ""),
        completion: true,
        processing: false,
      }),
    }));
    setTimeout(() => {
      try { if (!child.closed) child.close(); } catch { /* no-op */ }
    }, 900);
  }

  function inspectWindow(win, rootChild, depth = 0) {
    if (!win || depth > 4) return false;
    try {
      const doc = win.document;
      if (!doc) return false;
      autoScrollDocument(doc, win);
      const text = norm(doc.body?.innerText || doc.body?.textContent || doc.documentElement?.innerText || "");
      const completion = /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text)
        || /상품\s*수정\s*전송\s*완료/i.test(text);
      const processing = /처리중입니다/i.test(text)
        || /잠시만\s*기다려주시기\s*바랍니다/i.test(text);
      if (completion && !processing) {
        signalComplete(rootChild, String(win.location?.href || ""), String(doc.title || ""));
        return true;
      }
      const frames = Array.from(win.frames || []);
      for (const frame of frames) {
        if (inspectWindow(frame, rootChild, depth + 1)) return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  function prepareFormTarget(form) {
    if (!captureActive() || !(form instanceof HTMLFormElement)) return null;
    const existing = formTargets.get(form);
    if (existing && Date.now() - existing.preparedAt < 3000) return existing.child || null;

    if (lastOpenedChild && Date.now() - lastOpenedAt < 1200) {
      try {
        if (!lastOpenedChild.closed) {
          formTargets.set(form, { preparedAt: Date.now(), child: lastOpenedChild, originalTarget: null });
          return lastOpenedChild;
        }
      } catch { /* continue */ }
    }

    const originalTarget = String(form.getAttribute("target") || form.target || "").trim();
    const lower = originalTarget.toLowerCase();
    if (!originalTarget || ["_self", "_top", "_parent"].includes(lower)) return null;

    let targetName = originalTarget;
    if (lower === "_blank") {
      targetName = `commerce_os_a21_result_${Date.now()}_${++targetSeq}`;
      form.target = targetName;
    }

    let child = null;
    try {
      child = originalOpen("about:blank", targetName, "width=1500,height=900,resizable=yes,scrollbars=yes");
    } catch { /* popup blocker or transient navigation */ }
    if (child) track(child);

    formTargets.set(form, { preparedAt: Date.now(), child, originalTarget, targetName });
    setTimeout(() => {
      try {
        const row = formTargets.get(form);
        if (!row) return;
        if (row.originalTarget && form.target === row.targetName) form.target = row.originalTarget;
      } catch { /* no-op */ }
    }, 1500);

    if (!child) {
      setTimeout(() => {
        try {
          const reacquired = originalOpen("", targetName);
          if (reacquired) {
            track(reacquired);
            const row = formTargets.get(form);
            if (row) row.child = reacquired;
          }
        } catch { /* no-op */ }
      }, 120);
    }
    return child;
  }

  window.open = function commerceOsA21WindowOpen(...args) {
    const child = originalOpen(...args);
    if (captureActive()) track(child);
    return child;
  };
  try { Object.defineProperty(window.open, "name", { value: "open" }); } catch { /* no-op */ }

  HTMLFormElement.prototype.submit = function commerceOsA21FormSubmit(...args) {
    prepareFormTarget(this);
    return nativeSubmit.apply(this, args);
  };

  if (typeof nativeRequestSubmit === "function") {
    HTMLFormElement.prototype.requestSubmit = function commerceOsA21RequestSubmit(...args) {
      prepareFormTarget(this);
      return nativeRequestSubmit.apply(this, args);
    };
  }

  document.addEventListener("submit", (event) => {
    if (event.target instanceof HTMLFormElement) prepareFormTarget(event.target);
  }, true);

  function wrapShoplingSubmit() {
    const current = window.goods_mallMdfy_submit_sp;
    if (typeof current !== "function" || current.__commerceOsA21V034Wrapped) return;
    const original = current;
    const wrapped = function commerceOsA21SingleSubmit(...args) {
      const now = Date.now();
      if (now - lastSubmitAt < 5000) {
        return lastSubmitReturn;
      }
      lastSubmitAt = now;
      captureUntil = now + 10_000;
      lastOpenedChild = null;
      lastOpenedAt = 0;
      lastSubmitReturn = original.apply(this, args);
      return lastSubmitReturn;
    };
    wrapped.__commerceOsA21V034Wrapped = true;
    wrapped.__commerceOsA21Original = original;
    try { window.goods_mallMdfy_submit_sp = wrapped; } catch { /* retry on next tick */ }
  }

  wrapShoplingSubmit();
  setInterval(wrapShoplingSubmit, 80);

  setInterval(() => {
    for (const child of [...tracked]) {
      try {
        if (!child || child.closed) {
          tracked.delete(child);
          continue;
        }
      } catch {
        tracked.delete(child);
        continue;
      }
      inspectWindow(child, child, 0);
    }
  }, 300);
})();

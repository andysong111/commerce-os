(() => {
  if (window.__commerceOsA21ResultLoadingV036Installed) return;
  window.__commerceOsA21ResultLoadingV036Installed = true;

  const VERSION = "0.3.6";
  const STABLE_MS = 1800;
  const POLL_MS = 250;
  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  let stableSignature = "";
  let stableSince = 0;
  let completionSent = false;
  let lastStatusAt = 0;

  function inspect() {
    const text = norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || "");
    if (!text) return null;

    const processing = /처리중입니다/i.test(text)
      || /잠시만\s*기다려주시기\s*바랍니다/i.test(text);
    const resultHeading = /쇼핑몰\s*상품\s*수정\s*전송\s*결과/i.test(text)
      || /상품\s*수정\s*전송\s*결과/i.test(text);
    const hasTotals = /총건수\s*[:：]?\s*\d+/i.test(text)
      && /성공건수\s*[:：]?\s*\d+/i.test(text)
      && /실패건수\s*[:：]?\s*\d+/i.test(text);
    const hasOutcomeRows = /성공여부/i.test(text) && /쇼핑몰상품코드/i.test(text);
    const footer = /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text)
      || /상품\s*수정\s*전송\s*완료/i.test(text);
    const resultEvidence = resultHeading || hasTotals || hasOutcomeRows || footer;
    const successCount = (text.match(/성공건수\s*[:：]?\s*\d+/gi) || []).length;
    const failureCount = (text.match(/실패건수\s*[:：]?\s*\d+/gi) || []).length;

    return {
      processing,
      resultEvidence,
      footer,
      ready: document.readyState === "complete",
      bodyLength: text.length,
      successCount,
      failureCount,
      href: String(location.href || ""),
      title: String(document.title || ""),
    };
  }

  function send(type, snapshot) {
    chrome.runtime.sendMessage({
      type,
      version: VERSION,
      snapshot,
      frameHref: String(location.href || ""),
      topFrame: window === window.top,
    }).catch(() => null);
  }

  function tick() {
    if (completionSent) return;
    const snapshot = inspect();
    if (!snapshot || !snapshot.resultEvidence) {
      stableSignature = "";
      stableSince = 0;
      return;
    }

    const now = Date.now();
    if (snapshot.processing || !snapshot.ready) {
      stableSignature = "";
      stableSince = 0;
      if (now - lastStatusAt > 800) {
        lastStatusAt = now;
        send("A21_RESULT_LOADING_V036", snapshot);
      }
      return;
    }

    const signature = [
      snapshot.bodyLength,
      snapshot.successCount,
      snapshot.failureCount,
      snapshot.footer ? 1 : 0,
    ].join(":");

    if (signature !== stableSignature) {
      stableSignature = signature;
      stableSince = now;
      send("A21_RESULT_STABILIZING_V036", snapshot);
      return;
    }

    const stableMs = now - stableSince;
    if (stableMs >= STABLE_MS) {
      completionSent = true;
      send("A21_RESULT_COMPLETE_V036", { ...snapshot, stableMs });
    } else if (now - lastStatusAt > 800) {
      lastStatusAt = now;
      send("A21_RESULT_STABILIZING_V036", { ...snapshot, stableMs });
    }
  }

  const observer = new MutationObserver(() => tick());
  try {
    observer.observe(document.documentElement || document, { subtree: true, childList: true, characterData: true, attributes: true });
  } catch { /* document not ready yet */ }

  window.addEventListener("load", () => tick(), { once: false });
  setInterval(tick, POLL_MS);
  tick();
})();

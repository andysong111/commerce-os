(() => {
  if (globalThis.__commerceOsA21ResultWatchV040Installed) return;
  globalThis.__commerceOsA21ResultWatchV040Installed = true;

  const VERSION = "0.4.0";
  const POLL_MS = 350;
  const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  let lastSignature = "";
  let lastSentAt = 0;

  function scrollResultToBottom() {
    try {
      const root = document.scrollingElement || document.documentElement || document.body;
      if (root) root.scrollTop = root.scrollHeight;
      window.scrollTo(0, Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0));
      for (const element of document.querySelectorAll("div,section,main,table,tbody")) {
        if (!(element instanceof HTMLElement)) continue;
        if (element.scrollHeight > element.clientHeight + 40) element.scrollTop = element.scrollHeight;
      }
    } catch { /* visual helper only */ }
  }

  function snapshot() {
    const text = normalize(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || "");
    if (!text) return null;

    const listPage = /쇼핑몰상품수정/i.test(text) && /검색항목/i.test(text) && /상품\s*수정전송/i.test(text);
    const configPage = /상품수정\s*송신/i.test(text) && /일반내용수정/i.test(text) && /옵션송신/i.test(text);
    const processing = /처리중입니다/i.test(text) || /잠시만\s*기다려주시기\s*바랍니다/i.test(text);
    const resultHeading = /쇼핑몰\s*상품\s*수정\s*전송\s*결과/i.test(text) || /상품\s*수정\s*전송\s*결과/i.test(text);
    const successCountLabels = (text.match(/성공건수\s*[:：]?\s*[\d,]+/gi) || []).length;
    const failCountLabels = (text.match(/실패건수\s*[:：]?\s*[\d,]+/gi) || []).length;
    const outcomeRows = /성공여부/i.test(text) && /쇼핑몰상품코드/i.test(text);
    const footer = /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text) || /상품\s*수정\s*전송\s*완료/i.test(text);
    const evidence = resultHeading || successCountLabels > 0 || failCountLabels > 0 || outcomeRows || footer;

    if ((listPage || configPage) && !evidence && !processing) return null;
    if (!evidence && !processing) return null;

    scrollResultToBottom();

    return {
      version: VERSION,
      processing,
      evidence,
      strongEvidence: footer,
      footer,
      resultHeading,
      successCountLabels,
      failCountLabels,
      outcomeRows,
      readyState: document.readyState,
      href: String(location.href || ""),
      title: String(document.title || ""),
      bodyLength: text.length,
      topFrame: window === window.top,
    };
  }

  function sendStatus(force = false) {
    const snap = snapshot();
    if (!snap) return;
    const signature = [
      snap.processing ? 1 : 0,
      snap.evidence ? 1 : 0,
      snap.strongEvidence ? 1 : 0,
      snap.footer ? 1 : 0,
      snap.successCountLabels,
      snap.failCountLabels,
      snap.outcomeRows ? 1 : 0,
      snap.readyState,
      snap.bodyLength,
    ].join(":");
    const now = Date.now();
    if (!force && signature === lastSignature && now - lastSentAt < 900) return;
    lastSignature = signature;
    lastSentAt = now;
    chrome.runtime.sendMessage({ type: "A21_RESULT_STATUS_V040", snapshot: snap }).catch(() => null);
  }

  try {
    const observer = new MutationObserver(() => sendStatus(true));
    observer.observe(document.documentElement || document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
  } catch { /* document can still be bootstrapping */ }

  window.addEventListener("load", () => sendStatus(true));
  setInterval(() => sendStatus(false), POLL_MS);
  sendStatus(true);
})();

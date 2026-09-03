(() => {
  const VERSION = "0.3.4";
  const COMPLETE_EVENT = "commerce-os-a21-v034-result-complete";
  let sentAt = 0;

  document.addEventListener(COMPLETE_EVENT, (event) => {
    const now = Date.now();
    if (now - sentAt < 800) return;
    sentAt = now;
    let detail = null;
    try { detail = JSON.parse(String(event?.detail || "{}")); } catch { detail = {}; }
    chrome.runtime.sendMessage({
      type: "A21_RESULT_COMPLETE_V034",
      version: VERSION,
      completion: detail?.completion === true,
      processing: detail?.processing === true,
      href: String(detail?.href || ""),
      title: String(detail?.title || ""),
    }).catch(() => null);
  });
})();

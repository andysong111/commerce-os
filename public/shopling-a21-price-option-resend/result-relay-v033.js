(() => {
  const VERSION = "0.3.3";
  const COMPLETE_EVENT = "commerce-os-a21-v033-result-complete";

  document.addEventListener(COMPLETE_EVENT, (event) => {
    let detail = {};
    try { detail = JSON.parse(String(event?.detail || "{}")); } catch { /* ignore */ }
    chrome.runtime.sendMessage({
      type: "A21_RESULT_COMPLETE_V033",
      version: VERSION,
      completion: true,
      processing: false,
      href: String(detail?.href || ""),
      title: String(detail?.title || ""),
    }).catch(() => null);
  });
})();

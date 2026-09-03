(() => {
  const VERSION = "0.3.2";
  let sent = false;
  let observer = null;
  let timer = null;

  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

  function inspect() {
    const text = norm(document.body?.innerText || document.body?.textContent || "");
    const completion = /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text)
      || /상품\s*수정\s*전송\s*완료/i.test(text);
    const processing = /처리중입니다/i.test(text)
      || /잠시만\s*기다려주시기\s*바랍니다/i.test(text);
    return { completion, processing, href: location.href, title: document.title || "" };
  }

  async function reportIfComplete() {
    if (sent) return;
    const state = inspect();
    if (!state.completion || state.processing) return;
    sent = true;
    await chrome.runtime.sendMessage({
      type: "A21_RESULT_COMPLETE_V032",
      version: VERSION,
      completion: true,
      processing: false,
      href: state.href,
      title: state.title,
    }).catch(() => null);
    if (observer) observer.disconnect();
    if (timer) clearInterval(timer);
  }

  function start() {
    void reportIfComplete();
    observer = new MutationObserver(() => void reportIfComplete());
    const root = document.documentElement || document;
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    timer = setInterval(() => void reportIfComplete(), 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

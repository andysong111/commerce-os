(() => {
  const VERSION = "0.2.8";
  const POLL_MS = 500;
  let clearSince = 0;
  let lastSignature = "";

  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function hasVisibleProcessingOverlay() {
    const nodes = document.querySelectorAll("div,section,article,p,span,td,strong,b");
    for (const node of nodes) {
      if (!visible(node)) continue;
      const text = norm(node.textContent || "");
      if (!text || text.length > 220) continue;
      if (/처리중입니다/.test(text) || /잠시만\s*기다려주시기\s*바랍니다/.test(text)) return true;
    }
    return false;
  }

  function sample() {
    const text = norm(document.body?.innerText || document.body?.textContent || "");
    const processing = hasVisibleProcessingOverlay();
    const resultEvidence = /쇼핑몰\s*상품\s*수정\s*전송\s*결과|상품\s*수정\s*전송중입니다|성공건수|실패건수|총건수/i.test(text);
    return { processing, resultEvidence };
  }

  async function emit() {
    const { processing, resultEvidence } = sample();
    if (!processing && !resultEvidence) {
      clearSince = 0;
      lastSignature = "";
      return;
    }

    if (processing) clearSince = 0;
    else if (!clearSince) clearSince = Date.now();

    const clearForMs = clearSince ? Date.now() - clearSince : 0;
    const signature = `${processing ? 1 : 0}|${resultEvidence ? 1 : 0}|${Math.floor(clearForMs / 1000)}`;
    if (signature === lastSignature) return;
    lastSignature = signature;

    await chrome.runtime.sendMessage({
      type: "A21_RESULT_LOADING_V028",
      version: VERSION,
      processing,
      resultEvidence,
      clearForMs,
      href: location.href,
    }).catch(() => null);
  }

  const observer = new MutationObserver(() => void emit());
  const start = () => {
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
    void emit();
    setInterval(() => void emit(), POLL_MS);
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();

(() => {
  const MARKER_ID = "commerce-os-stock-a6-frame-bridge-v0231";
  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const compact = (value) => norm(value).replace(/\s+/g, "");

  function hasA6SearchControl() {
    const selects = [...document.querySelectorAll("select")];
    return selects.some((select) =>
      [...select.options].some((option) => compact(option.textContent) === "옵션자체관리코드"),
    );
  }

  function hasSearchFormEvidence() {
    const controls = [...document.querySelectorAll("input,textarea")];
    return controls.some((control) => {
      const hint = norm(`${control.getAttribute?.("placeholder") || ""} ${control.name || ""} ${control.id || ""}`);
      return /상품검색코드|자사상품코드|검색|search|query/i.test(hint);
    });
  }

  function hasA6PageEvidence() {
    const path = String(location.pathname || "").toLowerCase();
    const text = norm(document.body?.innerText || document.body?.textContent || "");
    return /prodbulkoptlst\.phtml/i.test(path) || /\[A6\]|옵션대량수정/i.test(text);
  }

  function ensureMarker() {
    if (!document.body || document.getElementById(MARKER_ID)) return false;
    if (!hasA6PageEvidence() || !hasA6SearchControl() || !hasSearchFormEvidence()) return false;
    const marker = document.createElement("span");
    marker.id = MARKER_ID;
    marker.setAttribute("aria-hidden", "true");
    marker.setAttribute("data-commerce-os-stock-role", "A6");
    marker.textContent = "[A6] 옵션대량수정 검색항목";
    Object.assign(marker.style, {
      position: "fixed",
      left: "-10000px",
      top: "-10000px",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      opacity: "0.01",
      pointerEvents: "none",
      whiteSpace: "nowrap",
    });
    document.body.appendChild(marker);
    return true;
  }

  if (!ensureMarker()) {
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (ensureMarker() || attempts >= 80) window.clearInterval(timer);
    }, 250);
    const observer = new MutationObserver(() => {
      if (ensureMarker()) observer.disconnect();
    });
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 20_000);
  }
})();
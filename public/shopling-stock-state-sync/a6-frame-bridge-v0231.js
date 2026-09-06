(() => {
  const MARKER_ID = "commerce-os-stock-a6-frame-bridge-v0232";
  const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const compact = (value) => norm(value).replace(/\s+/g, "");

  function hasA6SearchControl() {
    const selects = [...document.querySelectorAll("select")];
    return selects.some((select) =>
      [...select.options].some((option) => compact(option.textContent) === "옵션자체관리코드"),
    );
  }

  function ensureMarker() {
    if (!document.body || document.getElementById(MARKER_ID)) return false;
    // Shopling A6 is split across legacy frames. The visible title/path/search-input hint can
    // live in another frame, but the exact "옵션자체관리코드" search option is the stable
    // A6-specific control. Use only that unique control as the frame role signal.
    if (!hasA6SearchControl()) return false;
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
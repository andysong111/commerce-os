(() => {
  const MARKER_ID = "commerce-os-shopling-a6-role-marker-v015";

  function norm(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function looksLikeA6Page() {
    const text = norm(document.body?.innerText || document.body?.textContent || "");
    if (!/옵션대량수정/i.test(text)) return false;
    const hasA6Title = /\[?A?6\]?\s*옵션대량수정/i.test(text);
    const hasA6Controls = /옵션수량변경/i.test(text) && /검색항목/i.test(text);
    return hasA6Title && hasA6Controls;
  }

  function ensureMarker() {
    if (!document.body || !looksLikeA6Page() || document.getElementById(MARKER_ID)) return;
    const marker = document.createElement("span");
    marker.id = MARKER_ID;
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = "일괄 상태변경";
    marker.style.position = "fixed";
    marker.style.left = "-100000px";
    marker.style.top = "0";
    marker.style.width = "1px";
    marker.style.height = "1px";
    marker.style.overflow = "hidden";
    marker.style.pointerEvents = "none";
    document.body.appendChild(marker);
  }

  ensureMarker();
  const observer = new MutationObserver(() => ensureMarker());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

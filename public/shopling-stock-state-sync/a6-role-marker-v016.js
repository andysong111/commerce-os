(() => {
  const MARKER_ID = "commerce-os-shopling-a6-role-marker-v016";

  function norm(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function selectHasOption(label) {
    const wanted = norm(label);
    return [...document.querySelectorAll("select")].some((select) =>
      [...select.options].some((option) => norm(option.textContent).includes(wanted)),
    );
  }

  function looksLikeA6Page() {
    if (!document.body) return false;
    const text = norm(document.body.innerText || document.body.textContent || "");
    const hasA6Title = /\[?A?6\]?\s*옵션대량수정/i.test(text);
    const hasSearchLabel = /검색항목/i.test(text);
    const hasOwnOptionCodeSearch = selectHasOption("옵션자체관리코드");
    return hasA6Title && hasSearchLabel && hasOwnOptionCodeSearch;
  }

  function ensureMarker() {
    if (!looksLikeA6Page() || document.getElementById(MARKER_ID)) return;
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

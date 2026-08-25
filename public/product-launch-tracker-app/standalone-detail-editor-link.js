const DETAIL_SELECTOR = "button[data-action='detail']";

installStandaloneDetailEditorLink();

function installStandaloneDetailEditorLink() {
  if (window.__commerceOsStandaloneDetailEditorInstalled) return;
  window.__commerceOsStandaloneDetailEditorInstalled = true;

  document.addEventListener("pointerdown", interceptDetailPointer, true);
  document.addEventListener("click", openStandaloneEditor, true);
  window.addEventListener(
    "pagehide",
    () => {
      document.removeEventListener("pointerdown", interceptDetailPointer, true);
      document.removeEventListener("click", openStandaloneEditor, true);
    },
    { once: true },
  );
}

function interceptDetailPointer(event) {
  if (event.shiftKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest(DETAIL_SELECTOR)) return;
  // Prevent legacy detail preload modules from starting for the normal click path.
  event.stopImmediatePropagation();
}

function openStandaloneEditor(event) {
  if (event.shiftKey) return;
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest(DETAIL_SELECTOR);
  if (!button) return;
  const row = button.closest("tr[data-id]");
  const itemId = String(row?.dataset.id || "").trim();
  if (!itemId) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  const url = `/product-launch-editor?itemId=${encodeURIComponent(itemId)}`;
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) window.location.assign(url);
}

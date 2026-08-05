const OPTIONS_EDITOR_SELECTOR = ".inline-options-editor";
const TABLE_BODY_SELECTOR = "#launch-table-body";
const RESTORE_WINDOW_MS = 1_500;

let lastEditor = null;
let restoreQueued = false;

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installInlineOptionsFocusGuard();
}

export function rememberInlineOptionsEditor(input, now = Date.now()) {
  if (!(input instanceof HTMLInputElement)) return null;
  const row = input.closest("tr[data-id]");
  const id = String(row?.dataset.id ?? "").trim();
  if (!id) return null;
  return {
    id,
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd,
    value: input.value,
    rememberedAt: now,
  };
}

function installInlineOptionsFocusGuard() {
  const tableBody = document.querySelector(TABLE_BODY_SELECTOR);
  if (!tableBody || window.__commerceOsInlineOptionsFocusGuardInstalled) return;
  window.__commerceOsInlineOptionsFocusGuardInstalled = true;

  document.addEventListener("focusin", rememberFromEvent, true);
  document.addEventListener("input", rememberFromEvent, true);
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.matches(OPTIONS_EDITOR_SELECTOR)) return;
      lastEditor = null;
    },
    true,
  );

  const observer = new MutationObserver(queueRestore);
  observer.observe(tableBody, { childList: true, subtree: true });

  function rememberFromEvent(event) {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (!event.target.matches(OPTIONS_EDITOR_SELECTOR)) return;
    lastEditor = rememberInlineOptionsEditor(event.target);
  }

  function queueRestore() {
    if (restoreQueued || !lastEditor) return;
    restoreQueued = true;
    queueMicrotask(() => {
      restoreQueued = false;
      restoreFocusIfNeeded();
    });
  }

  function restoreFocusIfNeeded() {
    if (!lastEditor) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && active.matches(OPTIONS_EDITOR_SELECTOR)) {
      lastEditor = rememberInlineOptionsEditor(active);
      return;
    }
    if (active && active !== document.body && active !== document.documentElement) return;
    if (Date.now() - lastEditor.rememberedAt > RESTORE_WINDOW_MS) {
      lastEditor = null;
      return;
    }

    const row = [...tableBody.querySelectorAll("tr[data-id]")].find(
      (candidate) => String(candidate.dataset.id ?? "").trim() === lastEditor.id,
    );
    const replacement = row?.querySelector(OPTIONS_EDITOR_SELECTOR);
    if (!(replacement instanceof HTMLInputElement) || replacement.disabled) return;

    replacement.focus({ preventScroll: true });
    const max = replacement.value.length;
    const start = Math.min(lastEditor.selectionStart ?? max, max);
    const end = Math.min(lastEditor.selectionEnd ?? start, max);
    try {
      replacement.setSelectionRange(start, end);
    } catch {
      // Some input types do not support selection ranges.
    }
    lastEditor = rememberInlineOptionsEditor(replacement);
  }
}

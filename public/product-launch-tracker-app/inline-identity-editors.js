const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const EXTERNAL_STATE_EVENT = "product-launch-tracker:external-state";
const TABLE_BODY_SELECTOR = "#launch-table-body";

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installInlineIdentityEditors();
}

export function normalizeInlineModelNumber(value) {
  const compact = String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/^AAA0*(\d+)$/);
  return match ? `AAA${match[1].padStart(3, "0")}` : compact;
}

export function updateTrackerIdentityState(storedState, id, field, value, now) {
  if (!storedState || typeof storedState !== "object" || Array.isArray(storedState)) {
    return { changed: false, state: storedState };
  }
  const items = Array.isArray(storedState.items) ? storedState.items : [];
  const normalizedId = String(id ?? "").trim();
  const normalizedValue =
    field === "modelNumber"
      ? normalizeInlineModelNumber(value)
      : String(value ?? "").trim();
  if (!normalizedId || !normalizedValue || !["modelNumber", "productName"].includes(field)) {
    return { changed: false, state: storedState };
  }

  let changed = false;
  const nextItems = items.map((item) => {
    if (String(item?.id ?? "").trim() !== normalizedId) return item;
    if (String(item?.[field] ?? "").trim() === normalizedValue) return item;
    changed = true;
    return {
      ...item,
      [field]: normalizedValue,
      updatedAt: now,
      updatedBy: "승준",
    };
  });
  if (!changed) return { changed: false, state: storedState };

  return {
    changed: true,
    state: {
      ...storedState,
      savedAt: now,
      items: nextItems,
    },
  };
}

function installInlineIdentityEditors() {
  const tableBody = document.querySelector(TABLE_BODY_SELECTOR);
  if (!tableBody || window.__commerceOsInlineIdentityEditorsInstalled) return;
  window.__commerceOsInlineIdentityEditorsInstalled = true;
  installStyles();

  tableBody.addEventListener("change", handleChange);
  tableBody.addEventListener("input", handleBarcodeInput);
  tableBody.addEventListener("keydown", handleKeydown);

  const observer = new MutationObserver(enhanceRows);
  observer.observe(tableBody, { childList: true, subtree: true });
  enhanceRows();

  function enhanceRows() {
    for (const row of tableBody.querySelectorAll("tr[data-id]")) {
      enhanceIdentityInputs(row);
      updateBarcodeWarning(row.querySelector(".barcode-input"));
    }
  }

  function enhanceIdentityInputs(row) {
    const modelCell =
      row.querySelector('[data-column-key="modelNumber"]') ??
      row.querySelector(".model-number")?.closest("td");
    if (modelCell && !modelCell.querySelector(".inline-model-number-editor")) {
      const original = modelCell.querySelector(".model-number");
      const value = String(original?.textContent ?? modelCell.textContent ?? "").trim();
      const input = createEditor("inline-model-number-editor", value, "모델번호");
      if (original) original.replaceWith(input);
      else modelCell.prepend(input);
    }

    const productCell =
      row.querySelector('[data-column-key="productName"]') ??
      row.querySelector("td.product-name");
    if (productCell && !productCell.querySelector(".inline-product-name-editor")) {
      const value = String(productCell.textContent ?? "").trim();
      const input = createEditor("inline-product-name-editor", value, "모델명");
      productCell.replaceChildren(input);
      productCell.title = value;
    }
  }

  function createEditor(className, value, label) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = className;
    input.value = value;
    input.autocomplete = "off";
    input.setAttribute("aria-label", `${label} 수정`);
    input.title = `${label}을 수정한 뒤 Enter 또는 다른 칸을 누르면 저장됩니다.`;
    return input;
  }

  function handleChange(event) {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (event.target.matches(".barcode-input")) {
      updateBarcodeWarning(event.target);
      return;
    }
    const field = event.target.matches(".inline-model-number-editor")
      ? "modelNumber"
      : event.target.matches(".inline-product-name-editor")
        ? "productName"
        : "";
    if (!field) return;

    const row = event.target.closest("tr[data-id]");
    const id = String(row?.dataset.id ?? "").trim();
    const stored = readStoredState();
    const currentItem = stored?.items?.find(
      (item) => String(item?.id ?? "").trim() === id,
    );
    const currentValue = String(currentItem?.[field] ?? "").trim();
    const nextValue =
      field === "modelNumber"
        ? normalizeInlineModelNumber(event.target.value)
        : event.target.value.trim();

    if (!nextValue) {
      event.target.value = currentValue;
      showToast(`${field === "modelNumber" ? "모델번호" : "모델명"}은 비워둘 수 없습니다.`);
      return;
    }

    const now = new Date().toISOString();
    const result = updateTrackerIdentityState(stored, id, field, nextValue, now);
    event.target.value = nextValue;
    if (!result.changed) return;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(result.state));
    window.dispatchEvent(
      new CustomEvent(EXTERNAL_STATE_EVENT, {
        detail: {
          typingGuardBypass: true,
          source: "inline-identity-editor",
          itemId: id,
          field,
        },
      }),
    );
    showToast(`${field === "modelNumber" ? "모델번호" : "모델명"}을 저장했습니다.`);
  }

  function handleBarcodeInput(event) {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (!event.target.matches(".barcode-input")) return;
    updateBarcodeWarning(event.target);
  }

  function handleKeydown(event) {
    if (
      event.key !== "Enter" ||
      event.isComposing ||
      !(event.target instanceof HTMLInputElement) ||
      !event.target.matches(
        ".inline-model-number-editor, .inline-product-name-editor",
      )
    ) {
      return;
    }
    event.preventDefault();
    event.target.blur();
  }
}

function updateBarcodeWarning(input) {
  if (!(input instanceof HTMLInputElement)) return;
  const empty = input.value.trim() === "";
  input.classList.toggle("barcode-required-empty", empty);
  input.setAttribute("aria-invalid", String(empty));
  input.title = empty
    ? "기준바코드가 비어 있습니다. 바코드·위치코드를 입력하세요."
    : "기준 바코드";
}

function readStoredState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function installStyles() {
  if (document.querySelector("#inline-identity-editor-styles")) return;
  const style = document.createElement("style");
  style.id = "inline-identity-editor-styles";
  style.textContent = `
    .inline-model-number-editor,
    .inline-product-name-editor {
      width: 100%;
      min-width: 0;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      padding: 7px 8px;
      color: inherit;
      font: inherit;
      font-weight: 700;
    }
    .inline-product-name-editor { font-weight: 600; }
    .inline-model-number-editor:hover,
    .inline-product-name-editor:hover {
      border-color: #cbd5e1;
      background: #ffffff;
    }
    .inline-model-number-editor:focus,
    .inline-product-name-editor:focus {
      outline: none;
      border-color: #2563eb;
      background: #ffffff;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
    }
    .barcode-input.barcode-required-empty {
      border-color: #dc2626 !important;
      background: #fef2f2 !important;
      box-shadow: 0 0 0 1px rgba(220, 38, 38, 0.18) !important;
    }
    .barcode-input.barcode-required-empty::placeholder {
      color: #dc2626;
    }
  `;
  document.head.append(style);
}

let toastTimer;
function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

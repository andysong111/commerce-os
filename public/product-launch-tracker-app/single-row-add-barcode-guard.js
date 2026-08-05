import { normalizeBarcode } from "./lib/tracker-core.mjs";

const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const EXTERNAL_STATE_EVENT = "product-launch-tracker:external-state";

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installSingleRowAddBarcodeGuard();
}

export function syncAddedSingleRowBarcode(
  storedState,
  itemId,
  now = new Date().toISOString(),
) {
  if (!storedState || typeof storedState !== "object" || Array.isArray(storedState)) {
    return { changed: false, state: storedState };
  }
  const items = Array.isArray(storedState.items) ? storedState.items : [];
  const normalizedId = String(itemId ?? "").trim();
  if (!normalizedId) return { changed: false, state: storedState };

  let changed = false;
  const nextItems = items.map((item) => {
    if (String(item?.id ?? "").trim() !== normalizedId) return item;
    const options = Array.isArray(item?.orderOptions) ? item.orderOptions : [];
    if (options.length !== 1) return item;
    const option =
      options[0] && typeof options[0] === "object"
        ? options[0]
        : { saleOption: options[0] };
    const mainBarcode = normalizeBarcode(item?.barcode);
    const optionBarcode = normalizeBarcode(option?.barcode);
    const barcode = mainBarcode || optionBarcode;
    if (!barcode || (mainBarcode === barcode && optionBarcode === barcode)) {
      return item;
    }
    changed = true;
    return {
      ...item,
      barcode,
      orderOptions: [{ ...option, barcode }],
      updatedAt: now,
      updatedBy: "행 추가 바코드 동기화",
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

function installSingleRowAddBarcodeGuard() {
  if (window.__commerceOsSingleRowAddBarcodeGuardInstalled) return;
  window.__commerceOsSingleRowAddBarcodeGuardInstalled = true;
  window.addEventListener(EXTERNAL_STATE_EVENT, handleSingleRowAddEvent, true);
}

function handleSingleRowAddEvent(event) {
  if (
    event.detail?.source !== "single-row-add" ||
    event.detail?.barcodeGuardApplied === true
  ) {
    return;
  }
  const itemId = String(event.detail?.itemId ?? "").trim();
  if (!itemId) return;

  let storedState;
  try {
    storedState = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return;
  }
  const result = syncAddedSingleRowBarcode(storedState, itemId);
  if (!result.changed) return;

  event.stopImmediatePropagation();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(result.state));
  queueMicrotask(() => {
    window.dispatchEvent(
      new CustomEvent(EXTERNAL_STATE_EVENT, {
        detail: {
          ...event.detail,
          typingGuardBypass: true,
          barcodeGuardApplied: true,
        },
      }),
    );
  });
}

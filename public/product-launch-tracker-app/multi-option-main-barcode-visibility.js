const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const ITEM_PATCHED_EVENT = "product-launch-tracker:item-patched";
const tableBody = document.querySelector("#launch-table-body");

let syncQueued = false;

installStyles();
queueSync();

if (tableBody) {
  new MutationObserver(queueSync).observe(tableBody, {
    childList: true,
    subtree: true,
  });
}

window.addEventListener(ITEM_PATCHED_EVENT, queueSync);
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) queueSync();
});

function installStyles() {
  if (document.querySelector("#multi-option-main-barcode-visibility-styles")) return;
  const style = document.createElement("style");
  style.id = "multi-option-main-barcode-visibility-styles";
  style.textContent = `
    [data-column-key="barcode"].uses-option-location-only > .barcode-input {
      display: none !important;
    }
    [data-column-key="barcode"].uses-option-location-only > .inline-option-location-list {
      margin-top: 0;
      padding-top: 0;
      border-top: 0;
    }
  `;
  document.head.append(style);
}

function queueSync() {
  if (syncQueued) return;
  syncQueued = true;
  window.requestAnimationFrame(() => {
    syncQueued = false;
    syncMainBarcodeVisibility();
  });
}

function syncMainBarcodeVisibility() {
  if (!tableBody) return;
  const trackerState = readTrackerState();
  const items = Array.isArray(trackerState?.items) ? trackerState.items : [];
  const itemById = new Map(items.map((item) => [String(item?.id ?? ""), item]));

  for (const row of tableBody.querySelectorAll("tr[data-id]")) {
    const item = itemById.get(String(row.dataset.id ?? ""));
    const barcodeCell = row.querySelector("[data-column-key='barcode']");
    const barcodeInput = barcodeCell?.querySelector(".barcode-input");
    if (!(barcodeCell instanceof HTMLElement) || !(barcodeInput instanceof HTMLInputElement)) {
      continue;
    }

    const actualOptionCount = (Array.isArray(item?.orderOptions) ? item.orderOptions : [])
      .filter((option) => String(option?.saleOption ?? "").trim())
      .length;
    const usesOptionLocationOnly = actualOptionCount >= 2;

    barcodeCell.classList.toggle("uses-option-location-only", usesOptionLocationOnly);
    barcodeInput.hidden = usesOptionLocationOnly;
    barcodeInput.tabIndex = usesOptionLocationOnly ? -1 : 0;
    barcodeInput.setAttribute("aria-hidden", usesOptionLocationOnly ? "true" : "false");
  }
}

function readTrackerState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const ITEM_PATCHED_EVENT = "product-launch-tracker:item-patched";
const tableBody = document.querySelector("#launch-table-body");

let renderQueued = false;

installStyles();
queueRender();

if (tableBody) {
  new MutationObserver(queueRender).observe(tableBody, {
    childList: true,
    subtree: true,
  });
}

window.addEventListener(ITEM_PATCHED_EVENT, (event) => {
  const itemId = String(event?.detail?.itemId ?? "");
  if (event?.detail?.source === "option-location") {
    synchronizeContainerSignature(itemId);
    return;
  }
  queueRender();
});
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) queueRender();
});

function installStyles() {
  if (document.querySelector("#option-location-inline-editor-styles")) return;
  const style = document.createElement("style");
  style.id = "option-location-inline-editor-styles";
  style.textContent = `
    [data-column-key="barcode"] {
      min-width: 270px;
      vertical-align: top;
      text-align: left;
    }
    [data-column-key="barcode"] > .barcode-input {
      display: block;
      margin-left: 0;
      margin-right: auto;
    }
    .inline-option-location-list {
      display: grid;
      gap: 6px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px dashed #cbd5e1;
      justify-items: start;
    }
    .inline-option-location-title {
      color: #475569;
      font-size: 11px;
      font-weight: 900;
      line-height: 1.2;
      text-align: left;
    }
    .inline-option-location-row {
      display: grid;
      width: 100%;
      grid-template-columns: minmax(94px, 112px) minmax(120px, 1fr);
      align-items: center;
      justify-items: start;
      gap: 7px;
    }
    .inline-option-location-label {
      overflow: hidden;
      width: 100%;
      color: #334155;
      font-size: 11px;
      font-weight: 800;
      line-height: 1.3;
      text-align: left;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .inline-option-location-input {
      box-sizing: border-box;
      width: 112px;
      max-width: 112px;
      min-width: 94px;
      justify-self: start;
      border: 1px solid #94a3b8;
      border-radius: 7px;
      background: #fff;
      padding: 6px 7px;
      color: #0f172a;
      font: inherit;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .inline-option-location-input[data-empty="true"] {
      border-color: #f97316;
      background: #fff7ed;
      box-shadow: inset 3px 0 0 #f97316;
    }
    .inline-option-location-input:focus {
      outline: 2px solid #93c5fd;
      border-color: #2563eb;
      background: #fff;
      box-shadow: none;
    }
  `;
  document.head.append(style);
}

function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  window.requestAnimationFrame(() => {
    renderQueued = false;
    renderOptionLocationEditors();
  });
}

function renderOptionLocationEditors() {
  if (!tableBody) return;
  const trackerState = readTrackerState();
  const items = Array.isArray(trackerState?.items) ? trackerState.items : [];
  const itemById = new Map(items.map((item) => [String(item?.id ?? ""), item]));

  for (const row of tableBody.querySelectorAll("tr[data-id]")) {
    for (const oldContainer of row.querySelectorAll(
      "[data-column-key='options'] .inline-option-location-list",
    )) {
      oldContainer.remove();
    }

    const itemId = String(row.dataset.id ?? "");
    const item = itemById.get(itemId);
    const cell = row.querySelector("[data-column-key='barcode']");
    if (!(cell instanceof HTMLElement) || !item) continue;

    const optionEntries = optionEntriesFor(item);
    let container = cell.querySelector(".inline-option-location-list");
    if (optionEntries.length < 2) {
      container?.remove();
      continue;
    }

    const signature = buildSignature(optionEntries);
    if (container?.dataset.signature === signature) continue;

    if (!(container instanceof HTMLElement)) {
      container = document.createElement("div");
      container.className = "inline-option-location-list";
      cell.append(container);
    }
    container.dataset.signature = signature;
    container.replaceChildren();

    const title = document.createElement("div");
    title.className = "inline-option-location-title";
    title.textContent = "옵션별 위치코드";
    container.append(title);

    for (const { option, index } of optionEntries) {
      const labelText = String(option?.saleOption ?? "").trim();
      const optionId = String(option?.id ?? "");
      const locationCode = normalizeLocationCode(option?.barcode);

      const optionRow = document.createElement("label");
      optionRow.className = "inline-option-location-row";

      const label = document.createElement("span");
      label.className = "inline-option-location-label";
      label.textContent = labelText;
      label.title = labelText;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "inline-option-location-input";
      input.value = locationCode;
      input.dataset.empty = locationCode ? "false" : "true";
      input.dataset.itemId = itemId;
      input.dataset.optionId = optionId;
      input.dataset.optionIndex = String(index);
      input.dataset.optionLabel = labelText;
      input.autocomplete = "off";
      input.setAttribute("aria-label", `${labelText} 위치코드`);
      input.addEventListener("input", () => {
        input.dataset.empty = input.value.trim() ? "false" : "true";
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          input.blur();
        }
      });

      optionRow.append(input, label);
      container.append(optionRow);
    }
  }
}

function synchronizeContainerSignature(itemId) {
  if (!tableBody || !itemId) return;
  const trackerState = readTrackerState();
  const item = trackerState?.items?.find(
    (candidate) => String(candidate?.id ?? "") === itemId,
  );
  const row = tableBody.querySelector(`tr[data-id="${cssEscape(itemId)}"]`);
  const container = row?.querySelector(
    "[data-column-key='barcode'] .inline-option-location-list",
  );
  if (!(container instanceof HTMLElement) || !item) return;
  container.dataset.signature = buildSignature(optionEntriesFor(item));
}

function optionEntriesFor(item) {
  return (Array.isArray(item?.orderOptions) ? item.orderOptions : [])
    .map((option, index) => ({ option, index }))
    .filter(({ option }) => String(option?.saleOption ?? "").trim());
}

function buildSignature(optionEntries) {
  return JSON.stringify(
    optionEntries.map(({ option, index }) => ({
      id: String(option?.id ?? ""),
      index,
      label: String(option?.saleOption ?? "").trim(),
      barcode: normalizeLocationCode(option?.barcode),
    })),
  );
}

function readTrackerState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeLocationCode(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

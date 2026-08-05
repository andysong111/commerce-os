const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const tableBody = document.querySelector("#launch-table-body");

let renderQueued = false;
let toastTimer = null;

installStyles();
queueRender();

if (tableBody) {
  new MutationObserver(queueRender).observe(tableBody, {
    childList: true,
    subtree: true,
  });
}

window.addEventListener("product-launch-tracker:external-state", queueRender);
window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) queueRender();
});

function installStyles() {
  if (document.querySelector("#option-location-inline-editor-styles")) return;
  const style = document.createElement("style");
  style.id = "option-location-inline-editor-styles";
  style.textContent = `
    [data-column-key="options"] {
      min-width: 310px;
    }
    .inline-option-location-list {
      display: grid;
      gap: 6px;
      margin-top: 7px;
      padding-top: 7px;
      border-top: 1px dashed #cbd5e1;
    }
    .inline-option-location-title {
      color: #475569;
      font-size: 11px;
      font-weight: 900;
      line-height: 1.2;
    }
    .inline-option-location-row {
      display: grid;
      grid-template-columns: minmax(90px, 1fr) minmax(92px, 118px);
      align-items: center;
      gap: 7px;
    }
    .inline-option-location-label {
      overflow: hidden;
      color: #334155;
      font-size: 11px;
      font-weight: 800;
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .inline-option-location-input {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
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
    const itemId = String(row.dataset.id ?? "");
    const item = itemById.get(itemId);
    const cell = row.querySelector("[data-column-key='options']") || row.querySelector(".options-cell");
    if (!(cell instanceof HTMLElement) || !item) continue;

    const optionEntries = (Array.isArray(item.orderOptions) ? item.orderOptions : [])
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => String(option?.saleOption ?? "").trim());

    let container = cell.querySelector(".inline-option-location-list");
    if (!optionEntries.length) {
      container?.remove();
      continue;
    }

    const signature = JSON.stringify(
      optionEntries.map(({ option, index }) => ({
        id: String(option?.id ?? ""),
        index,
        label: String(option?.saleOption ?? "").trim(),
        barcode: normalizeLocationCode(option?.barcode),
      })),
    );
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
      input.addEventListener("change", () => {
        saveOptionLocationCode({
          itemId,
          optionId,
          optionIndex: index,
          optionLabel: labelText,
          rawValue: input.value,
          input,
        });
      });

      optionRow.append(label, input);
      container.append(optionRow);
    }
  }
}

function saveOptionLocationCode({
  itemId,
  optionId,
  optionIndex,
  optionLabel,
  rawValue,
  input,
}) {
  const trackerState = readTrackerState();
  if (!trackerState || !Array.isArray(trackerState.items)) {
    showMessage("상품출시관리 저장 데이터를 읽지 못했습니다.");
    queueRender();
    return;
  }

  const itemIndex = trackerState.items.findIndex(
    (item) => String(item?.id ?? "") === itemId,
  );
  if (itemIndex < 0) {
    showMessage("위치코드를 저장할 상품을 찾지 못했습니다.");
    queueRender();
    return;
  }

  const item = trackerState.items[itemIndex];
  const options = Array.isArray(item?.orderOptions)
    ? item.orderOptions.map((option) => ({ ...option }))
    : [];
  let targetIndex = optionId
    ? options.findIndex((option) => String(option?.id ?? "") === optionId)
    : -1;
  if (targetIndex < 0 && options[optionIndex]) targetIndex = optionIndex;
  if (targetIndex < 0) {
    const matching = options
      .map((option, index) => ({ option, index }))
      .filter(
        ({ option }) =>
          String(option?.saleOption ?? "").trim() === optionLabel,
      );
    if (matching.length === 1) targetIndex = matching[0].index;
  }
  if (targetIndex < 0) {
    showMessage(`${optionLabel} 옵션을 다시 찾지 못했습니다.`);
    queueRender();
    return;
  }

  const nextCode = normalizeLocationCode(rawValue);
  const previousCode = normalizeLocationCode(options[targetIndex]?.barcode);
  input.value = nextCode;
  input.dataset.empty = nextCode ? "false" : "true";
  if (nextCode === previousCode) return;

  const now = new Date().toISOString();
  options[targetIndex] = {
    ...options[targetIndex],
    barcode: nextCode,
  };
  const nextItems = [...trackerState.items];
  nextItems[itemIndex] = {
    ...item,
    orderOptions: options,
    updatedAt: now,
    updatedBy: "승준",
  };
  const nextState = {
    ...trackerState,
    items: nextItems,
    savedAt: now,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  window.dispatchEvent(new CustomEvent("product-launch-tracker:external-state"));
  showMessage(
    nextCode
      ? `${optionLabel} 위치코드 ${nextCode} 저장`
      : `${optionLabel} 위치코드를 비웠습니다.`,
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

function showMessage(message) {
  const toast = document.querySelector("#toast");
  if (!(toast instanceof HTMLElement)) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    if (toast.textContent === message) toast.hidden = true;
  }, 4_000);
}

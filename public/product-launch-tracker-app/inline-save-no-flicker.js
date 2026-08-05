import {
  applyInlineOptionLabels,
  parseInlineOptionLabels,
} from "./lib/table-inline-ops.mjs";

const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const EXTERNAL_STATE_EVENT = "product-launch-tracker:external-state";
const ITEM_PATCHED_EVENT = "product-launch-tracker:item-patched";
const INLINE_INPUT_SELECTOR = [
  ".barcode-input",
  ".inline-category-editor",
  ".inline-options-editor",
  ".inline-option-location-input",
].join(", ");

let toastTimer = null;

document.addEventListener("change", handleInlineChange, true);

function handleInlineChange(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.matches(INLINE_INPUT_SELECTOR)) {
    return;
  }

  const row = input.closest("#launch-table-body tr[data-id]");
  if (!(row instanceof HTMLTableRowElement)) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const itemId = String(row.dataset.id ?? "");
  const trackerState = readTrackerState();
  if (!trackerState || !Array.isArray(trackerState.items)) {
    showMessage("상품출시관리 저장 데이터를 읽지 못했습니다.");
    return;
  }

  const itemIndex = trackerState.items.findIndex(
    (item) => String(item?.id ?? "") === itemId,
  );
  if (itemIndex < 0) {
    showMessage("저장할 상품을 찾지 못했습니다.");
    return;
  }

  const item = trackerState.items[itemIndex];
  const change = buildInlineChange(input, item);
  if (!change) return;

  const now = new Date().toISOString();
  const nextItem = {
    ...item,
    ...change.patch,
    updatedAt: now,
    updatedBy: "승준",
  };
  const nextItems = [...trackerState.items];
  nextItems[itemIndex] = nextItem;
  const nextState = {
    ...trackerState,
    items: nextItems,
    savedAt: now,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  synchronizeMainStateWithoutTableRender(itemId, change.source);
  window.dispatchEvent(
    new CustomEvent(ITEM_PATCHED_EVENT, {
      detail: {
        itemId,
        item: nextItem,
        source: change.source,
      },
    }),
  );
  showMessage(change.message);
}

function buildInlineChange(input, item) {
  if (input.matches(".barcode-input")) {
    const nextValue = normalizeLocationCode(input.value);
    const previousValue = normalizeLocationCode(item?.barcode);
    input.value = nextValue;
    if (nextValue === previousValue) return null;
    return {
      source: "barcode",
      patch: { barcode: nextValue },
      message: `${safeText(item?.modelNumber) || "상품"} 기준바코드 저장`,
    };
  }

  if (input.matches(".inline-category-editor")) {
    const nextValue = safeText(input.value);
    const previousValue = safeText(item?.shoplingCategory);
    input.value = nextValue;
    if (nextValue === previousValue) return null;
    return {
      source: "category",
      patch: { shoplingCategory: nextValue },
      message: `${safeText(item?.modelNumber) || "상품"} 카테고리 저장`,
    };
  }

  if (input.matches(".inline-options-editor")) {
    const labels = parseInlineOptionLabels(input.value);
    const currentLabels = (Array.isArray(item?.orderOptions) ? item.orderOptions : [])
      .map((option) => safeText(option?.saleOption))
      .filter(Boolean);
    input.value = labels.join(", ");
    if (labels.join("|") === currentLabels.join("|")) return null;
    const orderOptions = applyInlineOptionLabels(item?.orderOptions, labels);
    return {
      source: "options",
      patch: {
        options: labels,
        orderOptions,
      },
      message: `${safeText(item?.modelNumber) || "상품"} 옵션 저장`,
    };
  }

  if (input.matches(".inline-option-location-input")) {
    const options = Array.isArray(item?.orderOptions)
      ? item.orderOptions.map((option) => ({ ...option }))
      : [];
    const optionId = String(input.dataset.optionId ?? "");
    const optionIndex = Number(input.dataset.optionIndex);
    const optionLabel = String(input.dataset.optionLabel ?? "");
    let targetIndex = optionId
      ? options.findIndex((option) => String(option?.id ?? "") === optionId)
      : -1;
    if (targetIndex < 0 && Number.isInteger(optionIndex) && options[optionIndex]) {
      targetIndex = optionIndex;
    }
    if (targetIndex < 0) {
      const matching = options
        .map((option, index) => ({ option, index }))
        .filter(({ option }) => safeText(option?.saleOption) === optionLabel);
      if (matching.length === 1) targetIndex = matching[0].index;
    }
    if (targetIndex < 0) {
      showMessage(`${optionLabel || "해당"} 옵션을 다시 찾지 못했습니다.`);
      return null;
    }

    const nextValue = normalizeLocationCode(input.value);
    const previousValue = normalizeLocationCode(options[targetIndex]?.barcode);
    input.value = nextValue;
    input.dataset.empty = nextValue ? "false" : "true";
    if (nextValue === previousValue) return null;
    options[targetIndex] = {
      ...options[targetIndex],
      barcode: nextValue,
    };
    return {
      source: "option-location",
      patch: { orderOptions: options },
      message: nextValue
        ? `${optionLabel} 위치코드 ${nextValue} 저장`
        : `${optionLabel} 위치코드를 비웠습니다.`,
    };
  }

  return null;
}

function synchronizeMainStateWithoutTableRender(itemId, source) {
  const tableBody = document.querySelector("#launch-table-body");
  if (!(tableBody instanceof HTMLElement)) {
    window.dispatchEvent(
      new CustomEvent(EXTERNAL_STATE_EVENT, { detail: { itemId, source } }),
    );
    return;
  }

  const inheritedDescriptor = findPropertyDescriptor(tableBody, "innerHTML");
  const ownDescriptor = Object.getOwnPropertyDescriptor(tableBody, "innerHTML");
  if (!inheritedDescriptor?.get) {
    window.dispatchEvent(
      new CustomEvent(EXTERNAL_STATE_EVENT, { detail: { itemId, source } }),
    );
    return;
  }

  try {
    Object.defineProperty(tableBody, "innerHTML", {
      configurable: true,
      enumerable: inheritedDescriptor.enumerable ?? false,
      get() {
        return inheritedDescriptor.get.call(tableBody);
      },
      set() {
        // The main tracker still receives the new state, but the visible rows stay in place.
      },
    });
    window.dispatchEvent(
      new CustomEvent(EXTERNAL_STATE_EVENT, {
        detail: { itemId, source, suppressTableRender: true },
      }),
    );
  } catch (error) {
    console.error(error);
    window.dispatchEvent(
      new CustomEvent(EXTERNAL_STATE_EVENT, { detail: { itemId, source } }),
    );
  } finally {
    if (ownDescriptor) {
      Object.defineProperty(tableBody, "innerHTML", ownDescriptor);
    } else {
      delete tableBody.innerHTML;
    }
  }
}

function findPropertyDescriptor(target, property) {
  let current = target;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor) return descriptor;
    current = Object.getPrototypeOf(current);
  }
  return null;
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

function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function showMessage(message) {
  const toast = document.querySelector("#toast");
  if (!(toast instanceof HTMLElement)) return;
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    if (toast.textContent === message) toast.hidden = true;
  }, 3_200);
}

import {
  applyInlineOptionLabels,
  parseInlineOptionLabels,
} from "./lib/table-inline-ops.mjs";

const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const EXTERNAL_STATE_EVENT = "product-launch-tracker:external-state";
const ITEM_PATCHED_EVENT = "product-launch-tracker:item-patched";
const INLINE_INPUT_SELECTOR = [
  ".barcode-input",
  ".inline-model-number-editor",
  ".inline-product-name-editor",
  ".inline-category-editor",
  ".inline-options-editor",
  ".inline-option-location-input",
].join(", ");

const composingInputs = new WeakSet();
let toastTimer = null;

document.addEventListener("input", handleInlineInput, true);
document.addEventListener("change", handleInlineCommit, true);
document.addEventListener("keydown", handleInlineKeydown, true);
document.addEventListener("compositionstart", handleCompositionStart, true);
document.addEventListener("compositionend", handleCompositionEnd, true);
window.addEventListener("pagehide", flushActiveInlineInput);

function handleInlineInput(event) {
  const input = inlineInputFrom(event.target);
  if (!input) return;
  input.dataset.autosaveDirty = "true";
  setSaveStatus("입력 중 · 칸을 벗어나면 저장");
}

function handleInlineCommit(event) {
  const input = inlineInputFrom(event.target);
  if (!input) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  commitInlineChange(input);
}

function handleInlineKeydown(event) {
  const input = inlineInputFrom(event.target);
  if (
    !input ||
    event.key !== "Enter" ||
    event.isComposing ||
    event.keyCode === 229 ||
    composingInputs.has(input)
  ) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  commitInlineChange(input);
}

function handleCompositionStart(event) {
  const input = inlineInputFrom(event.target);
  if (input) composingInputs.add(input);
}

function handleCompositionEnd(event) {
  const input = inlineInputFrom(event.target);
  if (input) composingInputs.delete(input);
}

function flushActiveInlineInput() {
  const input = inlineInputFrom(document.activeElement);
  if (!input || composingInputs.has(input)) return;
  commitInlineChange(input, { silent: true });
}

function inlineInputFrom(target) {
  return target instanceof HTMLInputElement && target.matches(INLINE_INPUT_SELECTOR)
    ? target
    : null;
}

function commitInlineChange(input, { silent = false } = {}) {
  const row = input.closest("#launch-table-body tr[data-id]");
  if (!(row instanceof HTMLTableRowElement)) return false;

  const itemId = String(row.dataset.id ?? "");
  const trackerState = readTrackerState();
  if (!trackerState || !Array.isArray(trackerState.items)) {
    if (!silent) showMessage("상품출시관리 저장 데이터를 읽지 못했습니다.");
    return false;
  }

  const itemIndex = trackerState.items.findIndex(
    (item) => String(item?.id ?? "") === itemId,
  );
  if (itemIndex < 0) {
    if (!silent) showMessage("저장할 상품을 찾지 못했습니다.");
    return false;
  }

  const item = trackerState.items[itemIndex];
  const change = buildInlineChange(input, item, { silent });
  input.dataset.autosaveDirty = "false";
  if (!change) {
    setSaveStatus("변경 없음");
    return false;
  }

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
  setSaveStatus("브라우저 저장 완료 · 서버 저장 대기");
  if (!silent) showMessage(change.message);
  return true;
}

function buildInlineChange(input, item, { silent = false } = {}) {
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

  if (input.matches(".inline-model-number-editor")) {
    const previousValue = normalizeModelNumber(item?.modelNumber);
    const nextValue = normalizeModelNumber(input.value);
    if (!nextValue) {
      input.value = previousValue;
      if (!silent) showMessage("모델번호는 비워둘 수 없습니다.");
      return null;
    }
    input.value = nextValue;
    if (nextValue === previousValue) return null;
    return {
      source: "model-number",
      patch: { modelNumber: nextValue },
      message: `${nextValue} 모델번호 저장`,
    };
  }

  if (input.matches(".inline-product-name-editor")) {
    const previousValue = safeText(item?.productName);
    const nextValue = safeText(input.value);
    if (!nextValue) {
      input.value = previousValue;
      if (!silent) showMessage("모델명은 비워둘 수 없습니다.");
      return null;
    }
    input.value = nextValue;
    if (nextValue === previousValue) return null;
    return {
      source: "product-name",
      patch: { productName: nextValue },
      message: `${safeText(item?.modelNumber) || "상품"} 모델명 저장`,
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
      if (!silent) showMessage(`${optionLabel || "해당"} 옵션을 다시 찾지 못했습니다.`);
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
  const detail = {
    itemId,
    source,
    suppressTableRender: true,
    typingGuardBypass: true,
  };
  const tableBody = document.querySelector("#launch-table-body");
  if (!(tableBody instanceof HTMLElement)) {
    window.dispatchEvent(new CustomEvent(EXTERNAL_STATE_EVENT, { detail }));
    return;
  }

  const inheritedDescriptor = findPropertyDescriptor(tableBody, "innerHTML");
  const ownDescriptor = Object.getOwnPropertyDescriptor(tableBody, "innerHTML");
  if (!inheritedDescriptor?.get) {
    window.dispatchEvent(new CustomEvent(EXTERNAL_STATE_EVENT, { detail }));
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
        // The main tracker receives the new state while the visible rows stay in place.
      },
    });
    window.dispatchEvent(new CustomEvent(EXTERNAL_STATE_EVENT, { detail }));
  } catch (error) {
    console.error(error);
    window.dispatchEvent(new CustomEvent(EXTERNAL_STATE_EVENT, { detail }));
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

function normalizeModelNumber(value) {
  const compact = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  const match = compact.match(/^AAA0*(\d+)$/);
  return match ? `AAA${match[1].padStart(3, "0")}` : compact;
}

function safeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function setSaveStatus(message) {
  const element = document.querySelector("#save-status");
  if (element && element.textContent !== message) element.textContent = message;
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

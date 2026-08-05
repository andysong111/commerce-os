import {
  createLaunchItem,
  generateUniqueSelfCode,
  normalizeBarcode,
  normalizeModelNumber,
} from "./lib/tracker-core.mjs";

const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const EXTERNAL_STATE_EVENT = "product-launch-tracker:external-state";
const DRAFT_MARKER = "manualDetailDraft";
const BUTTON_ID = "add-items-button";

let activeDraftId = "";
let saveRequested = false;
let toastTimer = null;

if (typeof window !== "undefined" && typeof document !== "undefined") {
  // The legacy compact row-add module remains importable for old tests and
  // data helpers, but must not install another button in the live page.
  window.__commerceOsSingleRowAddInstalled = true;
  installManualDetailAdd();
}

export function nextManualTrackerRowNumber(itemsInput) {
  const items = Array.isArray(itemsInput) ? itemsInput : [];
  const rows = items.flatMap((item) => {
    const explicit = positiveInteger(item?.trackerRowNumber);
    const sourceRows = Array.isArray(item?.source?.rows)
      ? item.source.rows.map(positiveInteger).filter((value) => value !== null)
      : [];
    return explicit === null ? sourceRows : [explicit, ...sourceRows];
  });
  return Math.max(0, ...rows) + 1;
}

export function buildManualDetailDraftState(
  storedState,
  now = new Date().toISOString(),
  dependencies = {},
) {
  if (!storedState || typeof storedState !== "object" || Array.isArray(storedState)) {
    return {
      ok: false,
      message: "저장된 상품출시진행관리 데이터를 찾지 못했습니다.",
    };
  }

  const items = Array.isArray(storedState.items) ? storedState.items : [];
  const usedCodes = new Set(
    items.map((item) => String(item?.selfCodeBase ?? "").trim()).filter(Boolean),
  );
  const idFactory = dependencies.idFactory ?? (() => crypto.randomUUID());
  const optionIdFactory =
    dependencies.optionIdFactory ?? (() => crypto.randomUUID());
  const codeFactory =
    dependencies.codeFactory ?? ((used) => generateUniqueSelfCode(used));
  const selfCodeBase = codeFactory(usedCodes);
  const item = createLaunchItem(
    {
      workBatch: "신규 입고",
      warehouseLocation: "",
      barcode: "",
      modelNumber: "",
      productName: "",
      shoplingCategory: "",
      selfCodeBase,
      orderOptions: [
        {
          id: optionIdFactory(),
          optionName: "옵션",
          saleOption: "단품",
          chinaOption: "",
          barcode: "",
          baseSalePriceKrw: 0,
          unitCostKrw: 0,
          sourceOrderItemId: null,
        },
      ],
      notes: "",
      sourceFile: "상품출시진행관리 수동 입력",
      updatedBy: "승준",
    },
    idFactory,
  );
  item.trackerRowNumber = nextManualTrackerRowNumber(items);
  item.createdAt = now;
  item.updatedAt = now;
  item[DRAFT_MARKER] = true;

  return {
    ok: true,
    item,
    state: {
      ...storedState,
      schemaVersion: Math.max(3, Number(storedState.schemaVersion) || 3),
      savedAt: now,
      items: [...items, item],
    },
  };
}

export function finishManualDetailDraftState(
  storedState,
  itemId,
  keep,
  now = new Date().toISOString(),
) {
  if (!storedState || typeof storedState !== "object" || Array.isArray(storedState)) {
    return { changed: false, state: storedState, item: null };
  }
  const normalizedId = String(itemId ?? "").trim();
  if (!normalizedId) return { changed: false, state: storedState, item: null };

  const items = Array.isArray(storedState.items) ? storedState.items : [];
  let finishedItem = null;
  let changed = false;
  const nextItems = [];
  for (const item of items) {
    if (String(item?.id ?? "") !== normalizedId) {
      nextItems.push(item);
      continue;
    }
    changed = true;
    if (!keep) continue;
    const { [DRAFT_MARKER]: _draft, ...savedItem } = item;
    finishedItem = {
      ...savedItem,
      updatedAt: now,
      updatedBy: "승준",
    };
    nextItems.push(finishedItem);
  }

  if (!changed) return { changed: false, state: storedState, item: null };
  return {
    changed: true,
    item: finishedItem,
    state: {
      ...storedState,
      savedAt: now,
      items: nextItems,
    },
  };
}

function installManualDetailAdd() {
  if (window.__commerceOsManualDetailAddInstalled) return;
  window.__commerceOsManualDetailAddInstalled = true;

  const original = document.querySelector(`#${BUTTON_ID}`);
  const dialog = document.querySelector("#detail-dialog");
  const form = document.querySelector("#detail-form");
  if (!(original instanceof HTMLButtonElement)) return;
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (!(form instanceof HTMLFormElement)) return;

  const button = original.cloneNode(true);
  button.textContent = "+ 상품 추가";
  button.title = "출시 항목 상세 화면에서 새 상품 정보를 직접 입력합니다.";
  original.replaceWith(button);

  button.addEventListener("click", () => openManualDetail(dialog, form));
  form.addEventListener("submit", handleDraftSubmit, true);
  dialog.addEventListener("close", handleDraftClose);
  removeAbandonedDrafts();
}

function openManualDetail(dialog, form) {
  if (dialog.open) return;
  const storedState = readStoredState();
  const result = buildManualDetailDraftState(storedState);
  if (!result.ok) {
    showToast(result.message);
    return;
  }

  activeDraftId = result.item.id;
  saveRequested = false;
  resetFiltersForDraft();
  writeStoredState(result.state, {
    source: "manual-detail-add",
    itemId: activeDraftId,
  });

  window.requestAnimationFrame(() => {
    const row = [...document.querySelectorAll("#launch-table-body tr[data-id]")].find(
      (candidate) => String(candidate.dataset.id ?? "") === activeDraftId,
    );
    const detailButton = row?.querySelector("button[data-action='detail']");
    if (!(detailButton instanceof HTMLButtonElement)) {
      const rolledBack = finishManualDetailDraftState(
        readStoredState(),
        activeDraftId,
        false,
      );
      if (rolledBack.changed) writeStoredState(rolledBack.state);
      activeDraftId = "";
      showToast("새 상품 입력창을 열지 못했습니다. 페이지를 새로고침해 주세요.");
      return;
    }

    detailButton.click();
    decorateCreateDialog(result.item, form);
  });
}

function decorateCreateDialog(item, form) {
  const title = document.querySelector("#detail-dialog-title");
  const source = document.querySelector("#detail-source");
  const archive = document.querySelector("#archive-button");
  const saveButton = form.querySelector("button[value='save']");
  if (title) title.textContent = "새 상품 수동 입력";
  if (source) {
    source.innerHTML = `
      <strong>신규 상품 입력</strong><br />
      저장하면 상품출시진행관리 ${escapeHtml(item.trackerRowNumber)}행으로 추가됩니다.<br />
      모델번호·모델명·바코드·옵션·가격·중국 상품링크 등 필요한 내용을 이 화면에서 직접 입력하세요.`;
  }
  if (archive instanceof HTMLButtonElement) archive.hidden = true;
  if (saveButton instanceof HTMLButtonElement) saveButton.textContent = "상품 추가";
  window.setTimeout(() => form.elements.barcode?.focus(), 0);
}

function handleDraftSubmit(event) {
  if (!activeDraftId || event.submitter?.value !== "save") return;
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement)) return;
  if (String(form.elements.id?.value ?? "") !== activeDraftId) return;

  const modelNumber = normalizeModelNumber(form.elements.modelNumber?.value);
  const productName = String(form.elements.productName?.value ?? "").trim();
  if (!modelNumber || !productName) return;

  const storedState = readStoredState();
  const duplicate = (storedState?.items ?? []).some(
    (item) =>
      String(item?.id ?? "") !== activeDraftId &&
      normalizeModelNumber(item?.modelNumber) === modelNumber,
  );
  if (duplicate) {
    event.preventDefault();
    event.stopImmediatePropagation();
    saveRequested = false;
    showToast(`${modelNumber} 모델번호가 이미 존재합니다.`);
    return;
  }

  syncSingleOptionBarcode(form);
  saveRequested = true;
  queueMicrotask(() => {
    const dialog = document.querySelector("#detail-dialog");
    if (dialog?.open) saveRequested = false;
  });
}

function syncSingleOptionBarcode(form) {
  const rows = [
    ...document.querySelectorAll("#detail-options tr[data-option-index]"),
  ];
  if (rows.length !== 1) return;
  const optionInput = rows[0].querySelector("[data-field='barcode']");
  const mainInput = form.elements.barcode;
  if (!(optionInput instanceof HTMLInputElement)) return;
  if (!(mainInput instanceof HTMLInputElement)) return;
  const barcode = normalizeBarcode(mainInput.value || optionInput.value);
  mainInput.value = barcode;
  optionInput.value = barcode;
}

function handleDraftClose() {
  if (!activeDraftId) return;
  const keep = saveRequested;
  const result = finishManualDetailDraftState(
    readStoredState(),
    activeDraftId,
    keep,
  );
  const rowNumber = result.item?.trackerRowNumber;
  const modelNumber = result.item?.modelNumber;
  if (result.changed) {
    writeStoredState(result.state, {
      source: keep ? "manual-detail-add-saved" : "manual-detail-add-cancelled",
      itemId: activeDraftId,
    });
  }

  restoreDetailDialog();
  activeDraftId = "";
  saveRequested = false;
  if (keep && result.item) {
    showToast(
      `${rowNumber ? `${rowNumber}행 · ` : ""}${modelNumber || "새 상품"}을 추가했습니다.`,
    );
  }
}

function restoreDetailDialog() {
  const archive = document.querySelector("#archive-button");
  const saveButton = document.querySelector("#detail-form button[value='save']");
  if (archive instanceof HTMLButtonElement) archive.hidden = false;
  if (saveButton instanceof HTMLButtonElement) saveButton.textContent = "저장";
}

function removeAbandonedDrafts() {
  const storedState = readStoredState();
  if (!storedState || !Array.isArray(storedState.items)) return;
  const nextItems = storedState.items.filter((item) => item?.[DRAFT_MARKER] !== true);
  if (nextItems.length === storedState.items.length) return;
  writeStoredState(
    {
      ...storedState,
      savedAt: new Date().toISOString(),
      items: nextItems,
    },
    { source: "manual-detail-add-cleanup" },
  );
}

function resetFiltersForDraft() {
  const controls = [
    ["#search-input", "input", ""],
    ["#batch-filter", "change", ""],
    ["#assignee-filter", "change", ""],
    ["#overall-filter", "change", ""],
  ];
  for (const [selector, eventName, value] of controls) {
    const control = document.querySelector(selector);
    if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLSelectElement)) {
      continue;
    }
    control.value = value;
    control.dispatchEvent(new Event(eventName, { bubbles: true }));
  }
  const unfinished = document.querySelector("#unfinished-only-filter");
  if (unfinished instanceof HTMLInputElement && !unfinished.checked) {
    unfinished.checked = true;
    unfinished.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function readStoredState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function writeStoredState(state, detail = {}) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(
    new CustomEvent(EXTERNAL_STATE_EVENT, {
      detail: {
        typingGuardBypass: true,
        ...detail,
      },
    }),
  );
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) {
    window.alert(message);
    return;
  }
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4000);
}

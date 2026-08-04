const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const RUN_BUTTON_ID = "detail-page-dock-run-button";
const WARNING_CLASS = "detail-page-option-required-warning";
const MISSING_MESSAGE = "옵션란이 비어있습니다";

const tableBody = document.querySelector("#launch-table-body");
let refreshQueued = false;

installStyles();
installListeners();
scheduleRefresh();

function installStyles() {
  if (document.querySelector("#detail-page-option-guard-styles")) return;
  const style = document.createElement("style");
  style.id = "detail-page-option-guard-styles";
  style.textContent = `
    .detail-page-option-missing .inline-options-editor,
    .detail-page-option-missing.inline-options-editor {
      border-color: #e11d48 !important;
      background: #fff1f2 !important;
    }
    .${WARNING_CLASS} {
      margin-top: 5px;
      color: #be123c;
      font-size: 11px;
      font-weight: 900;
      line-height: 1.35;
      white-space: normal;
    }
  `;
  document.head.append(style);
}

function installListeners() {
  if (tableBody) {
    new MutationObserver(scheduleRefresh).observe(tableBody, {
      childList: true,
      subtree: true,
    });
  }

  document.addEventListener(
    "input",
    (event) => {
      if (event.target instanceof HTMLInputElement && event.target.matches(".inline-options-editor")) {
        scheduleRefresh();
      }
    },
    true,
  );

  document.addEventListener(
    "change",
    (event) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement &&
        (target.type === "checkbox" || target.matches(".inline-options-editor"))
      ) {
        window.setTimeout(scheduleRefresh, 0);
      }
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest(`#${RUN_BUTTON_ID}`);
      if (!button) return;
      const missing = selectedMissingRows();
      if (!missing.length) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      applyWarnings();
      showBlockedMessage(missing);
      missing[0]
        .querySelector(".inline-options-editor")
        ?.focus({ preventScroll: false });
    },
    true,
  );

  window.addEventListener("product-launch-tracker:external-state", scheduleRefresh);
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) scheduleRefresh();
  });
}

function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  window.requestAnimationFrame(() => {
    refreshQueued = false;
    applyWarnings();
    syncRunButton();
  });
}

function readTrackerState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function optionTextFromItem(item) {
  return (Array.isArray(item?.orderOptions) ? item.orderOptions : [])
    .map((option) => String(option?.saleOption ?? "").trim())
    .filter(Boolean)
    .join(", ")
    .trim();
}

function rowOptionText(row, itemById) {
  const input = row.querySelector(".inline-options-editor");
  if (input instanceof HTMLInputElement) return input.value.trim();
  const item = itemById.get(String(row.dataset.id ?? ""));
  return optionTextFromItem(item);
}

function itemMap() {
  const state = readTrackerState();
  const items = Array.isArray(state?.items) ? state.items : [];
  return new Map(items.map((item) => [String(item?.id ?? ""), item]));
}

function applyWarnings() {
  if (!tableBody) return;
  const itemById = itemMap();
  for (const row of tableBody.querySelectorAll("tr[data-id]")) {
    const cell =
      row.querySelector("[data-column-key='options']") ||
      row.querySelector(".options-cell");
    if (!(cell instanceof HTMLElement)) continue;

    const input = cell.querySelector(".inline-options-editor");
    const missing = !rowOptionText(row, itemById);
    cell.classList.toggle("detail-page-option-missing", missing);
    if (input instanceof HTMLInputElement) {
      input.setAttribute("aria-invalid", missing ? "true" : "false");
    }

    let warning = cell.querySelector(`.${WARNING_CLASS}`);
    if (missing && !warning) {
      warning = document.createElement("div");
      warning.className = WARNING_CLASS;
      warning.setAttribute("role", "alert");
      warning.textContent = MISSING_MESSAGE;
      cell.append(warning);
    } else if (!missing && warning) {
      warning.remove();
    }
  }
}

function selectedRows() {
  return [
    ...document.querySelectorAll(
      "#launch-table-body tr[data-id] input.row-check:checked",
    ),
  ]
    .map((input) => input.closest("tr[data-id]"))
    .filter((row) => row instanceof HTMLTableRowElement);
}

function selectedMissingRows() {
  const itemById = itemMap();
  return selectedRows().filter((row) => !rowOptionText(row, itemById));
}

function syncRunButton() {
  const button = document.querySelector(`#${RUN_BUTTON_ID}`);
  if (!(button instanceof HTMLButtonElement)) return;

  const selected = selectedRows();
  const missing = selectedMissingRows();
  if (missing.length) {
    button.dataset.optionGuardDisabled = "true";
    button.disabled = true;
    button.textContent = `옵션 입력 필요 (${missing.length}건)`;
    button.title = `${MISSING_MESSAGE}. 단일 상품은 ‘단품’, 옵션 상품은 실제 판매 옵션을 입력하세요.`;
    return;
  }

  if (button.dataset.optionGuardDisabled === "true") {
    delete button.dataset.optionGuardDisabled;
    if (!String(button.textContent ?? "").includes("중…")) {
      button.disabled = selected.length === 0;
      button.textContent = selected.length
        ? `선택 상세페이지 생성 (${selected.length}건)`
        : "선택 상세페이지 생성";
      button.title =
        "체크한 상품을 서버 작업으로 등록합니다. 화면을 닫아도 AI 생성은 계속됩니다.";
    }
  }
}

function showBlockedMessage(missingRows) {
  const modelNumbers = missingRows
    .map((row) => row.querySelector(".model-number")?.textContent?.trim())
    .filter(Boolean)
    .slice(0, 8);
  const prefix = modelNumbers.length ? `${modelNumbers.join(", ")} · ` : "";
  const message = `${prefix}${MISSING_MESSAGE}. 단일 상품은 ‘단품’, 옵션 상품은 실제 판매 옵션을 입력한 뒤 다시 실행하세요.`;

  const status = document.querySelector("#detail-page-dock-run-status");
  if (status instanceof HTMLElement) {
    status.textContent = message;
    status.dataset.tone = "error";
    status.hidden = false;
  }
  const toast = document.querySelector("#toast");
  if (toast instanceof HTMLElement) {
    toast.textContent = message;
    toast.hidden = false;
    window.setTimeout(() => {
      if (toast.textContent === message) toast.hidden = true;
    }, 15_000);
  }
}

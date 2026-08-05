const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const TRACKER_STATE_ENDPOINT = "/api/product-launch-tracker/state";
const BATCH_SELECTION_KEY = "productLaunchFlow.trackerBatchSelection.v1";
const MAX_SELECTION = 20;
const TABLE_BODY_SELECTOR = "#launch-table-body";
const TABLE_HEAD_SELECTOR = "#launch-table-head";

if (typeof window !== "undefined" && typeof document !== "undefined") {
  installProductLaunchFlowBatchHandoff();
}

export function assignBrowserTrackerRows(itemsInput) {
  const items = Array.isArray(itemsInput) ? itemsInput : [];
  const preferred = items.map(preferredRowNumber);
  const used = new Set(preferred.filter((value) => value !== null));
  let next = Math.max(0, ...used) + 1;
  return items.map((item, index) => {
    const candidate = preferred[index];
    let trackerRowNumber;
    if (candidate !== null && preferred.indexOf(candidate) === index) {
      trackerRowNumber = candidate;
    } else {
      while (used.has(next)) next += 1;
      trackerRowNumber = next;
      used.add(next);
      next += 1;
    }
    return { trackerRowNumber, item };
  });
}

export function compactTrackerRowExpression(values) {
  const rows = [...new Set(values.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))]
    .sort((left, right) => left - right);
  if (!rows.length) return "";
  const parts = [];
  let start = rows[0];
  let previous = rows[0];
  for (const current of rows.slice(1)) {
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    parts.push(start === previous ? String(start) : `${start}-${previous}`);
    start = current;
    previous = current;
  }
  parts.push(start === previous ? String(start) : `${start}-${previous}`);
  return parts.join(",");
}

function installProductLaunchFlowBatchHandoff() {
  if (window.__commerceOsProductLaunchFlowBatchHandoffInstalled) return;
  window.__commerceOsProductLaunchFlowBatchHandoffInstalled = true;
  installStyles();
  installBulkButton();
  enhanceTable();

  const tableBody = document.querySelector(TABLE_BODY_SELECTOR);
  const tableHead = document.querySelector(TABLE_HEAD_SELECTOR);
  const observer = new MutationObserver(() => {
    enhanceTable();
    refreshButton();
  });
  if (tableBody) observer.observe(tableBody, { childList: true, subtree: true });
  if (tableHead) observer.observe(tableHead, { childList: true, subtree: true });
  document.addEventListener("change", handleSelectionChange, true);
  window.addEventListener("product-launch-tracker:external-state", enhanceTable);
}

function installBulkButton() {
  const controls = document.querySelector(".bulk-controls");
  if (!controls || document.querySelector("#product-launch-flow-batch-button")) return;
  const button = document.createElement("button");
  button.id = "product-launch-flow-batch-button";
  button.type = "button";
  button.className = "button button-primary";
  button.textContent = "선택 상품을 출시플로우로 등록 진행";
  button.disabled = true;
  button.addEventListener("click", () => void handoffSelectedRows(button));
  controls.prepend(button);
}

function enhanceTable() {
  const headRow = document.querySelector(`${TABLE_HEAD_SELECTOR} tr`);
  if (headRow && !headRow.querySelector("[data-tracker-row-number-header]")) {
    const header = document.createElement("th");
    header.dataset.trackerRowNumberHeader = "true";
    header.className = "tracker-row-number-column";
    header.textContent = "행번호";
    const checkHeader = headRow.querySelector("th.check-column");
    checkHeader?.after(header);
  }

  const rowMap = readTrackerRowMap();
  for (const row of document.querySelectorAll(`${TABLE_BODY_SELECTOR} tr[data-id]`)) {
    const id = String(row.dataset.id ?? "").trim();
    let cell = row.querySelector("[data-tracker-row-number-cell]");
    if (!cell) {
      cell = document.createElement("td");
      cell.dataset.trackerRowNumberCell = "true";
      cell.className = "tracker-row-number-cell";
      const checkCell = row.querySelector("td.check-column");
      checkCell?.after(cell);
    }
    const trackerRowNumber = rowMap.get(id);
    cell.textContent = trackerRowNumber ? String(trackerRowNumber) : "-";
    cell.title = trackerRowNumber
      ? `상품출시진행관리 행번호 ${trackerRowNumber}`
      : "행번호를 확인하지 못했습니다.";
  }
}

function handleSelectionChange(event) {
  if (!(event.target instanceof HTMLInputElement)) return;
  if (!event.target.matches(".row-check, #select-visible")) return;
  queueMicrotask(refreshButton);
}

function refreshButton() {
  const button = document.querySelector("#product-launch-flow-batch-button");
  if (!(button instanceof HTMLButtonElement)) return;
  const count = selectedRowIds().length;
  button.disabled = count < 1 || count > MAX_SELECTION;
  button.textContent = count
    ? `선택 ${count}개를 출시플로우로 등록 진행`
    : "선택 상품을 출시플로우로 등록 진행";
  button.title = count > MAX_SELECTION
    ? `한 번에 최대 ${MAX_SELECTION}개까지 진행할 수 있습니다.`
    : "체크한 상품을 상품출시플로우로 일괄 전달합니다.";
}

async function handoffSelectedRows(button) {
  const itemIds = selectedRowIds();
  if (!itemIds.length) {
    showToast("상품출시플로우로 진행할 행을 체크하세요.");
    return;
  }
  if (itemIds.length > MAX_SELECTION) {
    showToast(`한 번에 최대 ${MAX_SELECTION}개 상품까지만 진행할 수 있습니다.`);
    return;
  }

  const rowMap = readTrackerRowMap();
  const rowNumbers = itemIds.map((id) => rowMap.get(id)).filter(Boolean);
  if (rowNumbers.length !== itemIds.length) {
    showToast("선택한 상품의 진행관리 행번호를 확인하지 못했습니다. 화면을 새로고침하세요.");
    return;
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "진행관리 저장 중...";
  try {
    await flushTrackerState();
    const payload = {
      version: 1,
      itemIds,
      rowExpression: compactTrackerRowExpression(rowNumbers),
      autoStart: true,
      selectedAt: new Date().toISOString(),
    };
    localStorage.setItem(BATCH_SELECTION_KEY, JSON.stringify(payload));
    window.location.assign("/product-launch-flow");
  } catch (error) {
    console.error(error);
    button.disabled = false;
    button.textContent = originalText;
    showToast(
      error instanceof Error
        ? error.message
        : "상품출시플로우로 선택 상품을 전달하지 못했습니다.",
    );
  }
}

async function flushTrackerState() {
  const serialized = localStorage.getItem(TRACKER_STORAGE_KEY);
  if (!serialized) throw new Error("저장된 상품출시진행관리 데이터를 찾지 못했습니다.");
  let state;
  try {
    state = JSON.parse(serialized);
  } catch {
    throw new Error("저장된 상품출시진행관리 데이터가 올바르지 않습니다.");
  }
  const response = await fetch(TRACKER_STATE_ENDPOINT, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state }),
    credentials: "same-origin",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.message || "상품출시진행관리 서버 저장을 완료하지 못했습니다.");
  }
}

function selectedRowIds() {
  return [...document.querySelectorAll(`${TABLE_BODY_SELECTOR} tr[data-id]`)]
    .filter((row) => row.querySelector(".row-check")?.checked)
    .map((row) => String(row.dataset.id ?? "").trim())
    .filter(Boolean);
}

function readTrackerRowMap() {
  try {
    const state = JSON.parse(localStorage.getItem(TRACKER_STORAGE_KEY) ?? "{}");
    const entries = assignBrowserTrackerRows(state?.items);
    return new Map(
      entries.map(({ trackerRowNumber, item }) => [String(item?.id ?? "").trim(), trackerRowNumber]),
    );
  } catch {
    return new Map();
  }
}

function preferredRowNumber(item) {
  const explicit = positiveInteger(item?.trackerRowNumber);
  if (explicit !== null) return explicit;
  const rows = Array.isArray(item?.source?.rows) ? item.source.rows : [];
  for (const value of rows) {
    const row = positiveInteger(value);
    if (row !== null) return row;
  }
  return null;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function installStyles() {
  if (document.querySelector("#product-launch-flow-batch-handoff-styles")) return;
  const style = document.createElement("style");
  style.id = "product-launch-flow-batch-handoff-styles";
  style.textContent = `
    .tracker-row-number-column,
    .tracker-row-number-cell {
      width: 78px;
      min-width: 78px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .tracker-row-number-cell {
      font-weight: 800;
      color: #334155;
      background: #f8fafc;
    }
    #product-launch-flow-batch-button {
      white-space: nowrap;
    }
  `;
  document.head.append(style);
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) {
    window.alert(message);
    return;
  }
  toast.textContent = message;
  toast.hidden = false;
  window.setTimeout(() => {
    toast.hidden = true;
  }, 4000);
}

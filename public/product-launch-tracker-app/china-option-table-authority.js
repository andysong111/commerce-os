import {
  alignChinaOptionMappingsToRegisteredOptions,
  normalizeRegisteredBcode,
} from "./lib/china-option-table-authority.mjs";

const detailDialog = document.querySelector("#detail-dialog");
const detailForm = document.querySelector("#detail-form");
const optionTableBody = document.querySelector("#detail-options");
let syncTimer = null;
let syncing = false;

scheduleSync(0);
scheduleSync(120);
scheduleSync(500);

document.addEventListener(
  "click",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button[data-action='detail']")) {
      scheduleSync(0);
      scheduleSync(180);
      scheduleSync(700);
    }
    if (
      target?.closest("#detail-form button[value='save'], #detail-form .detail-floating-save")
    ) {
      syncChinaOptionPanelToOptionTable();
    }
  },
  true,
);

detailForm?.addEventListener(
  "input",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.matches(
        "#detail-options [data-field='barcode'], #detail-options [data-field='saleOption']",
      )
    ) {
      scheduleSync(0);
    }
  },
  true,
);

detailDialog?.addEventListener("close", () => {
  if (syncTimer) window.clearTimeout(syncTimer);
  syncTimer = null;
});

window.addEventListener("product-launch-tracker:model-bcodes-reconciled", () => {
  scheduleSync(0);
  scheduleSync(120);
});

if (detailForm) {
  const observer = new MutationObserver(() => {
    if (!syncing && detailDialog?.open) scheduleSync(20);
  });
  observer.observe(detailForm, { childList: true, subtree: true });
}

function scheduleSync(delay = 20) {
  if (syncTimer) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    syncChinaOptionPanelToOptionTable();
  }, delay);
}

function syncChinaOptionPanelToOptionTable() {
  if (syncing || !detailDialog?.open || !detailForm || !optionTableBody) return;
  const panel = detailForm.querySelector("#optimized-china-order-map-wrap");
  const list = panel?.querySelector("#optimized-china-order-map-list");
  if (!panel || !list) return;

  const registered = readRegisteredOptionTableRows();
  const current = readChinaOptionPanelRows();
  const aligned = alignChinaOptionMappingsToRegisteredOptions(registered, current);
  if (samePanelRows(current, aligned)) {
    updateAuthorityStatus(panel, aligned.length);
    return;
  }

  syncing = true;
  try {
    renderAlignedRows(list, aligned);
    updateAuthorityStatus(panel, aligned.length);
    window.dispatchEvent(
      new CustomEvent("product-launch-tracker:china-options-aligned", {
        detail: {
          itemId: String(detailForm.elements?.id?.value ?? "").trim(),
          barcodes: aligned.map((row) => row.barcode),
        },
      }),
    );
  } finally {
    syncing = false;
  }
}

function readRegisteredOptionTableRows() {
  return [...optionTableBody.querySelectorAll("tr[data-option-index]")].map(
    (row, index) => ({
      id: String(row.dataset.optionId ?? `table-${index + 1}`).trim(),
      barcode: String(
        row.querySelector("[data-field='barcode']")?.value ?? "",
      ).trim(),
      saleOption: String(
        row.querySelector("[data-field='saleOption']")?.value ?? "",
      ).trim(),
    }),
  );
}

function readChinaOptionPanelRows() {
  return [
    ...(detailForm?.querySelectorAll("[data-optimized-china-order-map-row]") ?? []),
  ].map((row, index) => ({
    id: String(row.dataset.optionId ?? `panel-${index + 1}`).trim(),
    barcode: String(row.dataset.barcode ?? "").trim(),
    saleOption: String(row.dataset.saleOption ?? "").trim(),
    chinaOption: String(
      row.querySelector("[data-optimized-china-order-option-input]")?.value ?? "",
    ).trim(),
  }));
}

function samePanelRows(current, aligned) {
  const left = current.map((row) => ({
    barcode: normalizeRegisteredBcode(row.barcode),
    saleOption: String(row.saleOption ?? "").trim(),
    chinaOption: String(row.chinaOption ?? "").trim(),
  }));
  const right = aligned.map((row) => ({
    barcode: row.barcode,
    saleOption: row.saleOption,
    chinaOption: row.chinaOption,
  }));
  return JSON.stringify(left) === JSON.stringify(right);
}

function renderAlignedRows(list, rows) {
  if (!rows.length) {
    list.innerHTML =
      '<div class="optimized-china-order-empty">위 발주·입고 옵션가격에 유효한 바코드·위치코드가 없습니다. B-code를 먼저 등록하세요.</div>';
    return;
  }
  list.innerHTML = rows
    .map(
      (row) => `
        <div class="optimized-china-order-map-row" data-optimized-china-order-map-row data-option-id="${escapeAttribute(row.id)}" data-barcode="${escapeAttribute(row.barcode)}" data-sale-option="${escapeAttribute(row.saleOption)}">
          <span class="optimized-china-order-barcode">${escapeHtml(row.barcode)}</span>
          <span class="optimized-china-order-sale-option">${escapeHtml(row.saleOption || "단품")}</span>
          <input class="optimized-china-order-option-input" data-optimized-china-order-option-input type="text" autocomplete="off" placeholder="1688 실제 중국옵션명" value="${escapeAttribute(row.chinaOption)}" />
        </div>`,
    )
    .join("");
}

function updateAuthorityStatus(panel, count) {
  if (panel.dataset.dirty === "true") return;
  const status = panel.querySelector("#optimized-china-order-map-status");
  if (!status) return;
  status.textContent = count
    ? `발주·입고 옵션가격에 바코드·위치코드가 등록된 ${count}개 B-code만 표시합니다.`
    : "발주·입고 옵션가격에 등록된 유효 B-code가 없어 중국옵션을 표시하지 않습니다.";
  status.dataset.tone = count ? "saved" : "";
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("\n", " ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

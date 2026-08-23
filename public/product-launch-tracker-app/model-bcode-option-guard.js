import {
  reconcileModelOrderOptions,
  sameModelOrderOptions,
} from "./lib/model-bcode-order-options.mjs";

const OPTIMIZED_API = "/api/product-launch-tracker/normalized-optimized";
const MODEL_OPTIONS_API = "/api/product-launch-tracker/model-order-options";
const detailDialog = document.querySelector("#detail-dialog");
const detailForm = document.querySelector("#detail-form");
const optionTableBody = document.querySelector("#detail-options");
const RECONCILE_DELAYS = [40, 160, 420, 900, 1_600];

let renderSerial = 0;
let renderTimers = [];
let completedKey = "";

ensureOptionBarcodeHeader();
scheduleReconcile();

document.addEventListener(
  "click",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("button[data-action='detail']")) return;
    completedKey = "";
    ensureOptionBarcodeHeader();
    scheduleReconcile();
  },
  true,
);

detailDialog?.addEventListener("close", () => {
  completedKey = "";
  clearTimers();
});

function ensureOptionBarcodeHeader() {
  const headerRow = document.querySelector(".option-table thead tr");
  if (!headerRow || headerRow.querySelector("[data-option-barcode-no-header]")) return;
  const cells = [...headerRow.children];
  const bcodeIndex = cells.findIndex((cell) => /바코드|위치코드/.test(cell.textContent || ""));
  const header = document.createElement("th");
  header.dataset.optionBarcodeNoHeader = "true";
  header.textContent = "옵션바코드 NO";
  if (bcodeIndex >= 0 && cells[bcodeIndex]?.nextSibling) {
    headerRow.insertBefore(header, cells[bcodeIndex].nextSibling);
  } else {
    headerRow.append(header);
  }
}

function scheduleReconcile() {
  clearTimers();
  const serial = ++renderSerial;
  for (const delay of RECONCILE_DELAYS) {
    renderTimers.push(
      window.setTimeout(() => {
        if (serial !== renderSerial) return;
        void reconcileCurrentItem(serial);
      }, delay),
    );
  }
}

function clearTimers() {
  for (const timer of renderTimers) window.clearTimeout(timer);
  renderTimers = [];
}

async function reconcileCurrentItem(serial) {
  if (!detailDialog?.open || !detailForm) return;
  const itemId = String(detailForm.elements?.id?.value ?? "").trim();
  const modelNumber = String(detailForm.elements?.modelNumber?.value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!itemId || !/^AAA\d{3,}$/.test(modelNumber)) return;
  const key = `${itemId}:${modelNumber}`;
  if (completedKey === key) return;

  try {
    const [itemBody, authorityBody] = await Promise.all([
      readItem(itemId),
      requestJson(
        `${MODEL_OPTIONS_API}?${new URLSearchParams({ modelNumber }).toString()}`,
      ),
    ]);
    if (serial !== renderSerial || !detailDialog?.open) return;
    const item = itemBody?.item;
    const authority = Array.isArray(authorityBody?.options)
      ? authorityBody.options
      : [];
    if (!item || !authority.length) {
      setGuardStatus(
        authorityBody?.message ||
          `${modelNumber}의 실제 B-code 기준정보를 확인하지 못했습니다. 기존 옵션을 유지합니다.`,
        "error",
      );
      return;
    }

    const nextOptions = reconcileModelOrderOptions(item.orderOptions, authority);
    let displayOptions = nextOptions;
    if (!sameModelOrderOptions(item.orderOptions, nextOptions)) {
      await requestJson(OPTIMIZED_API, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "patch_item",
          itemId,
          patch: { orderOptions: nextOptions },
          updatedBy: "모델 B-code·옵션바코드NO 기준 자동정리",
        }),
      });
      const refreshed = await readItem(itemId);
      if (Array.isArray(refreshed?.item?.orderOptions)) {
        displayOptions = refreshed.item.orderOptions;
      }
    }
    if (serial !== renderSerial || !detailDialog?.open) return;

    ensureOptionBarcodeHeader();
    renderOptionTable(displayOptions);
    renderChinaOptionPanel(displayOptions);
    const syncStatus = document.querySelector("#china-sync-status");
    if (syncStatus) {
      syncStatus.textContent = `${displayOptions.length}개 연결 · B-code/옵션바코드NO 검증`;
      syncStatus.dataset.tone = "success";
    }
    const assignedCount = displayOptions.filter((option) => option.optionBarcodeNo).length;
    setGuardStatus(
      `${modelNumber}의 B-code ${displayOptions.length}개와 옵션바코드NO ${assignedCount}개를 원장 기준으로 표시합니다. 동일 B-code는 동일 옵션바코드NO를 사용합니다.`,
      assignedCount === displayOptions.length ? "saved" : "error",
    );
    completedKey = key;
  } catch (error) {
    setGuardStatus(
      error instanceof Error
        ? error.message
        : "모델별 B-code·옵션바코드NO를 확인하지 못했습니다.",
      "error",
    );
  }
}

function renderOptionTable(options) {
  if (!optionTableBody) return;
  ensureOptionBarcodeHeader();
  if (!options.length) {
    optionTableBody.innerHTML = `<tr><td colspan="7" class="option-empty">발주·입고 데이터가 아직 연결되지 않았습니다.</td></tr>`;
    return;
  }
  optionTableBody.innerHTML = options
    .map(
      (option, index) => `
        <tr data-option-index="${index}">
          <td><input data-field="optionName" value="${escapeAttribute(option.optionName || "옵션")}" placeholder="옵션" /></td>
          <td><input data-field="saleOption" value="${escapeAttribute(option.saleOption || "단품")}" placeholder="블랙" /></td>
          <td><input data-field="barcode" value="${escapeAttribute(option.barcode)}" placeholder="BAA1-1" /></td>
          <td><input data-field="optionBarcodeNo" value="${escapeAttribute(option.optionBarcodeNo)}" placeholder="저장 시 자동발급" readonly title="Commerce OS 옵션바코드 원장 자동발급값" /></td>
          <td><input data-field="baseSalePriceKrw" type="number" min="0" step="1" value="${Number(option.baseSalePriceKrw) || ""}" /></td>
          <td><input data-field="unitCostKrw" type="number" min="0" step="1" value="${Number(option.unitCostKrw) || ""}" /></td>
          <td><button class="option-remove" type="button" data-action="remove-option">×</button></td>
        </tr>`,
    )
    .join("");
}

function ensureChinaOptionPanel() {
  const section = detailForm?.querySelector("#optimized-china-product-links-section");
  if (!section) return null;
  let panel = section.querySelector("#optimized-china-order-map-wrap");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "optimized-china-order-map-wrap";
    panel.className = "optimized-china-order-map-wrap";
    panel.innerHTML = `
      <h4 class="optimized-china-order-map-title">B-code별 중국옵션</h4>
      <p class="optimized-china-order-map-help">판매옵션과 B-code는 Product Master의 모델번호별 실제 연결값입니다. 주문링크는 모델의 1번 중국 상품링크를 공통 사용하고 실제 중국옵션명만 저장합니다.</p>
      <div id="optimized-china-order-map-list" class="optimized-china-order-map-list"></div>
      <div id="optimized-china-order-map-status" class="optimized-china-order-status"></div>`;
    section.append(panel);
  }
  panel.dataset.dirty = "false";
  return panel;
}

function renderChinaOptionPanel(options) {
  const panel = ensureChinaOptionPanel();
  const list = panel?.querySelector("#optimized-china-order-map-list");
  if (!list) return;
  list.innerHTML = options
    .map(
      (option) => `
        <div class="optimized-china-order-map-row" data-optimized-china-order-map-row data-option-id="${escapeAttribute(option.id)}" data-barcode="${escapeAttribute(option.barcode)}" data-sale-option="${escapeAttribute(option.saleOption)}">
          <span class="optimized-china-order-barcode">${escapeHtml(option.barcode)}</span>
          <span class="optimized-china-order-sale-option">${escapeHtml(option.saleOption || "단품")}</span>
          <input class="optimized-china-order-option-input" data-optimized-china-order-option-input type="text" autocomplete="off" placeholder="1688 실제 중국옵션명" value="${escapeAttribute(option.chinaOption)}" />
        </div>`,
    )
    .join("");
}

function setGuardStatus(message, tone = "") {
  const status = detailForm?.querySelector("#optimized-china-order-map-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function readItem(itemId) {
  return requestJson(
    `${OPTIMIZED_API}?${new URLSearchParams({ mode: "item", id: itemId }).toString()}`,
  );
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", ...(init.headers ?? {}) },
    credentials: "same-origin",
    cache: "no-store",
    ...init,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.message || `요청 실패 (${response.status})`);
  }
  return body;
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

import { reconcileModelOrderOptions } from "./lib/model-bcode-order-options.mjs";
import { alignOptionTable } from "./option-barcode-column-alignment.js";

const OPTIMIZED_API = "/api/product-launch-tracker/normalized-optimized";
const detailDialog = document.querySelector("#detail-dialog");
const detailForm = document.querySelector("#detail-form");
const optionTableBody = document.querySelector("#detail-options");
const OPTION_BARCODE_NO_PATTERN = /^\d{12}$/;
const RECONCILE_DELAYS = [90, 520, 1_500];
const MAX_ERROR_RETRIES = 2;

let renderSerial = 0;
let renderTimers = [];
let completedKey = "";
let inFlightKey = "";
let errorRetryCount = 0;

alignOptionTable();
scheduleReconcile();

document.addEventListener(
  "click",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("button[data-action='detail']")) return;
    completedKey = "";
    inFlightKey = "";
    errorRetryCount = 0;
    alignOptionTable();
    scheduleReconcile();
  },
  true,
);

detailDialog?.addEventListener("close", () => {
  completedKey = "";
  inFlightKey = "";
  errorRetryCount = 0;
  clearTimers();
});

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

function scheduleErrorRetry(serial) {
  if (serial !== renderSerial || errorRetryCount >= MAX_ERROR_RETRIES) return;
  errorRetryCount += 1;
  renderTimers.push(
    window.setTimeout(() => {
      if (serial !== renderSerial) return;
      void reconcileCurrentItem(serial);
    }, 700 * errorRetryCount),
  );
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
  if (completedKey === key || inFlightKey) return;
  inFlightKey = key;

  try {
    const itemBody = await readItem(itemId);
    if (serial !== renderSerial || !detailDialog?.open) return;
    if (String(detailForm.elements?.id?.value ?? "").trim() !== itemId) return;

    const item = itemBody?.item;
    if (!item) {
      setGuardStatus("저장된 상품 옵션을 확인하지 못했습니다. 기존 화면 값을 유지합니다.", "error");
      scheduleErrorRetry(serial);
      return;
    }

    const savedOptions = Array.isArray(item.orderOptions)
      ? structuredClone(item.orderOptions)
      : [];
    if (!savedOptions.length) {
      setGuardStatus(
        "저장된 상품 옵션이 없습니다. 필요할 때 ‘발주·입고 데이터 불러오기’를 눌러 옵션을 가져온 뒤 직접 수정·삭제하고 저장하세요.",
        "",
      );
      completedKey = key;
      errorRetryCount = 0;
      return;
    }

    // Keep the legacy reconciliation utility loaded for diagnostics only. Product composition is
    // never replaced from model-level authority on detail-open because one model number can have
    // multiple packaging/variant products. The saved item options are the authority after import.
    void reconcileModelOrderOptions(savedOptions, savedOptions);
    const nextOptions = savedOptions;
    const missingOptionBarcodeNo = nextOptions.some(
      (option) =>
        String(option?.barcode || "").trim() &&
        !OPTION_BARCODE_NO_PATTERN.test(String(option?.optionBarcodeNo || "").trim()),
    );
    let displayOptions = nextOptions;

    // This patch never adds or removes options. It only re-saves the exact saved list so the
    // server-side option-barcode registry can attach a missing numeric optionBarcodeNo.
    if (missingOptionBarcodeNo) {
      await requestJson(OPTIMIZED_API, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "patch_item",
          itemId,
          patch: { orderOptions: nextOptions },
          updatedBy: "옵션바코드NO 원장 자동발급",
        }),
      });
      const refreshed = await readItem(itemId);
      if (Array.isArray(refreshed?.item?.orderOptions)) {
        displayOptions = refreshed.item.orderOptions;
      }
    }

    if (serial !== renderSerial || !detailDialog?.open) return;
    if (String(detailForm.elements?.id?.value ?? "").trim() !== itemId) return;

    renderOptionTable(displayOptions);
    renderChinaOptionPanel(displayOptions);
    const syncStatus = document.querySelector("#china-sync-status");
    if (syncStatus) {
      syncStatus.textContent = `${displayOptions.length}개 저장 옵션 · 수동 확정`;
      syncStatus.dataset.tone = "success";
    }
    const assignedCount = displayOptions.filter((option) =>
      OPTION_BARCODE_NO_PATTERN.test(String(option?.optionBarcodeNo || "").trim()),
    ).length;
    setGuardStatus(
      `발주·입고 옵션가격과 B-code별 중국옵션은 동일한 B-code 집합으로 유지합니다. ${modelNumber}은 저장된 상품 옵션 ${displayOptions.length}개를 최종 기준으로 사용하며, 모델번호 전체 B-code를 자동 추가·복원하지 않습니다. ‘발주·입고 데이터 불러오기’를 눌렀을 때만 외부 옵션을 다시 가져옵니다. 옵션바코드NO ${assignedCount}/${displayOptions.length}개 확인.`,
      assignedCount === displayOptions.length ? "saved" : "error",
    );
    completedKey = key;
    errorRetryCount = 0;
  } catch (error) {
    setGuardStatus(
      error instanceof Error
        ? error.message
        : "저장된 상품 옵션을 확인하지 못했습니다.",
      "error",
    );
    scheduleErrorRetry(serial);
  } finally {
    if (inFlightKey === key) inFlightKey = "";
  }
}

function renderOptionTable(options) {
  if (!optionTableBody) return;
  if (!options.length) {
    optionTableBody.innerHTML = `<tr><td colspan="7" class="option-empty">발주·입고 데이터가 아직 연결되지 않았습니다.</td></tr>`;
    alignOptionTable();
    return;
  }
  optionTableBody.innerHTML = options
    .map(
      (option, index) => `
        <tr data-option-index="${index}">
          <td><input data-field="optionName" value="${escapeAttribute(option.optionName || "옵션")}" placeholder="옵션" /></td>
          <td><input data-field="saleOption" value="${escapeAttribute(option.saleOption || "단품")}" placeholder="블랙" /></td>
          <td><input data-field="barcode" value="${escapeAttribute(option.barcode)}" placeholder="BAA1-1" /></td>
          <td><input data-field="optionBarcodeNo" inputmode="numeric" pattern="[0-9]*" value="${escapeAttribute(option.optionBarcodeNo)}" placeholder="숫자 12자리 자동발급" readonly title="Commerce OS 숫자 전용 옵션바코드 원장 자동발급값" /></td>
          <td><input data-field="baseSalePriceKrw" type="number" min="0" step="1" value="${Number(option.baseSalePriceKrw) || ""}" /></td>
          <td><input data-field="unitCostKrw" type="number" min="0" step="1" value="${Number(option.unitCostKrw) || ""}" /></td>
          <td><button class="option-remove" type="button" data-action="remove-option">×</button></td>
        </tr>`,
    )
    .join("");
  alignOptionTable();
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
      <p class="optimized-china-order-map-help">이 상품에 저장한 옵션/B-code가 최종 기준입니다. 발주·입고 데이터는 사용자가 불러오기 버튼을 눌렀을 때만 초안으로 가져오며, 저장 후에는 자동으로 옵션을 추가하거나 복원하지 않습니다.</p>
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

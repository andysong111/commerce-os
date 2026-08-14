import {
  reconcileModelOrderOptions,
  sameModelOrderOptions,
} from "./lib/model-bcode-order-options.mjs";

const OPTIMIZED_API = "/api/product-launch-tracker/optimized";
const MODEL_OPTIONS_API = "/api/product-launch-tracker/model-order-options";
const detailDialog = document.querySelector("#detail-dialog");
const detailForm = document.querySelector("#detail-form");
const optionTableBody = document.querySelector("#detail-options");
const RECONCILE_DELAYS = [0, 80, 220, 500, 900, 1_600];
const DOM_ENFORCE_DELAYS = [30, 120, 320, 700, 1_400];

let renderSerial = 0;
let renderTimers = [];
let domTimers = [];
let completedKey = "";
let authoritativeKey = "";
let authoritativeOptions = [];

scheduleReconcile();

document.addEventListener(
  "click",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("button[data-action='detail']")) {
      resetAuthority();
      scheduleReconcile();
      return;
    }
    if (target.closest("#china-sync-button, #add-option-button")) {
      scheduleDomEnforcement();
    }
  },
  true,
);

// This ancestor capture listener runs before the form-level China-option save
// listener and before the optimized app's bubble submit listener. Therefore both
// saving paths see the exact same authoritative B-code set.
document.addEventListener("submit", enforceAuthorityBeforeSave, true);

detailForm?.elements?.modelNumber?.addEventListener("change", () => {
  resetAuthority();
  scheduleReconcile();
});

detailDialog?.addEventListener("close", () => {
  resetAuthority();
  clearTimers();
});

function resetAuthority() {
  completedKey = "";
  authoritativeKey = "";
  authoritativeOptions = [];
  unlockStructureControls();
}

function scheduleReconcile() {
  clearRenderTimers();
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

function scheduleDomEnforcement() {
  clearDomTimers();
  for (const delay of DOM_ENFORCE_DELAYS) {
    domTimers.push(
      window.setTimeout(() => {
        enforceCurrentDom();
      }, delay),
    );
  }
}

function clearRenderTimers() {
  for (const timer of renderTimers) window.clearTimeout(timer);
  renderTimers = [];
}

function clearDomTimers() {
  for (const timer of domTimers) window.clearTimeout(timer);
  domTimers = [];
}

function clearTimers() {
  clearRenderTimers();
  clearDomTimers();
}

async function reconcileCurrentItem(serial) {
  if (!detailDialog?.open || !detailForm) return;
  const itemId = String(detailForm.elements?.id?.value ?? "").trim();
  const modelNumber = currentModelNumber();
  if (!itemId || !modelNumber) return;
  const key = `${itemId}:${modelNumber}`;
  if (completedKey === key) return;

  try {
    const [itemBody, authorityBody] = await Promise.all([
      requestJson(
        `${OPTIMIZED_API}?${new URLSearchParams({ mode: "item", id: itemId }).toString()}`,
      ),
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

    authoritativeKey = key;
    authoritativeOptions = authority;
    const nextOptions = reconcileModelOrderOptions(item.orderOptions, authority);
    if (!sameModelOrderOptions(item.orderOptions, nextOptions)) {
      await requestJson(OPTIMIZED_API, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "patch_item",
          itemId,
          patch: { orderOptions: nextOptions },
          updatedBy: "모델 B-code 기준 자동정리",
        }),
      });
    }
    if (serial !== renderSerial || !detailDialog?.open) return;

    renderAuthoritativeOptions(nextOptions);
    const syncStatus = document.querySelector("#china-sync-status");
    if (syncStatus) {
      syncStatus.textContent = `${nextOptions.length}개 연결 · 모델 B-code 검증`;
      syncStatus.dataset.tone = "success";
    }
    setGuardStatus(
      `${modelNumber}에 실제 연결된 B-code ${nextOptions.length}개만 표시합니다. 발주·입고 옵션가격과 B-code별 중국옵션은 동일한 B-code 집합을 사용합니다.`,
      "saved",
    );
    completedKey = key;
  } catch (error) {
    setGuardStatus(
      error instanceof Error
        ? error.message
        : "모델별 실제 B-code를 확인하지 못했습니다.",
      "error",
    );
  }
}

function currentModelNumber() {
  const modelNumber = String(
    detailForm?.elements?.modelNumber?.value ?? "",
  )
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  return /^AAA\d{3,}$/.test(modelNumber) ? modelNumber : "";
}

function enforceAuthorityBeforeSave(event) {
  if (event.target !== detailForm || event.submitter?.value !== "save") return;
  enforceCurrentDom();
}

function enforceCurrentDom() {
  if (!detailDialog?.open || !authoritativeOptions.length) return;
  const itemId = String(detailForm?.elements?.id?.value ?? "").trim();
  const key = `${itemId}:${currentModelNumber()}`;
  if (!itemId || key !== authoritativeKey) return;

  const currentOptions = mergeChinaOptionsIntoTableRows(
    readOptionTableRows(),
    readChinaOptionRows(),
  );
  const nextOptions = reconcileModelOrderOptions(
    currentOptions,
    authoritativeOptions,
  );
  renderAuthoritativeOptions(nextOptions);
  setGuardStatus(
    `${currentModelNumber()}의 실제 B-code만 저장합니다. 임의 추가·삭제·B-code 변경은 Product Master 기준으로 자동 복원됩니다.`,
    "saved",
  );
}

function renderAuthoritativeOptions(options) {
  renderOptionTable(options);
  renderChinaOptionPanel(options);
  lockStructureControls();
}

function renderOptionTable(options) {
  if (!optionTableBody) return;
  optionTableBody.innerHTML = options
    .map(
      (option, index) => `
        <tr data-option-index="${index}" data-option-id="${escapeAttribute(option.id)}">
          <td><input data-field="optionName" value="${escapeAttribute(option.optionName || "옵션")}" placeholder="옵션" /></td>
          <td><input data-field="saleOption" value="${escapeAttribute(option.saleOption || "단품")}" placeholder="블랙" readonly aria-readonly="true" title="Product Master 모델별 판매옵션 기준값" /></td>
          <td><input data-field="barcode" value="${escapeAttribute(option.barcode)}" placeholder="BAA1-1" readonly aria-readonly="true" title="Product Master 모델별 B-code 기준값" /></td>
          <td><input data-field="baseSalePriceKrw" type="number" min="0" step="1" value="${Number(option.baseSalePriceKrw) || ""}" /></td>
          <td><input data-field="unitCostKrw" type="number" min="0" step="1" value="${Number(option.unitCostKrw) || ""}" /></td>
          <td><button class="option-remove" type="button" data-action="remove-option" disabled title="모델별 실제 B-code는 Product Master에서 관리합니다.">×</button></td>
        </tr>`,
    )
    .join("");
}

function readOptionTableRows() {
  return [...(optionTableBody?.querySelectorAll("tr[data-option-index]") ?? [])].map(
    (row, index) => {
      const get = (field) =>
        String(row.querySelector(`[data-field='${field}']`)?.value ?? "").trim();
      return {
        id: String(row.dataset.optionId ?? `option-${index + 1}`).trim(),
        optionName: get("optionName") || "옵션",
        saleOption: get("saleOption") || "단품",
        barcode: get("barcode"),
        baseSalePriceKrw: Math.max(
          0,
          Math.ceil(Number(get("baseSalePriceKrw")) || 0),
        ),
        unitCostKrw: Math.max(
          0,
          Math.ceil(Number(get("unitCostKrw")) || 0),
        ),
        sourceOrderItemId: null,
      };
    },
  );
}

function readChinaOptionRows() {
  return [...(
    detailForm?.querySelectorAll("[data-optimized-china-order-map-row]") ?? []
  )].map((row) => ({
    barcode: String(row.dataset.barcode ?? "").trim().toUpperCase(),
    saleOption: String(row.dataset.saleOption ?? "").trim(),
    chinaOption: String(
      row.querySelector("[data-optimized-china-order-option-input]")?.value ?? "",
    ).trim(),
  }));
}

function mergeChinaOptionsIntoTableRows(tableRows, chinaRows) {
  const byBarcode = new Map(
    chinaRows
      .filter((row) => row.barcode)
      .map((row) => [row.barcode, row.chinaOption]),
  );
  return tableRows.map((row) => ({
    ...row,
    chinaOption: byBarcode.get(String(row.barcode).toUpperCase()) || "",
  }));
}

function lockStructureControls() {
  const addButton = document.querySelector("#add-option-button");
  if (addButton) {
    addButton.disabled = true;
    addButton.title =
      "이 모델의 옵션 B-code는 Product Master 기준으로 자동관리됩니다.";
  }
}

function unlockStructureControls() {
  const addButton = document.querySelector("#add-option-button");
  if (addButton) {
    addButton.disabled = false;
    addButton.title = "";
  }
}

function ensureChinaOptionPanel() {
  const section = detailForm?.querySelector(
    "#optimized-china-product-links-section",
  );
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
  const status = detailForm?.querySelector(
    "#optimized-china-order-map-status",
  );
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
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

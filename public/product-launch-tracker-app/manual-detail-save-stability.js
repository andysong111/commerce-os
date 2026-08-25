const OPTIMIZED_API_PATH = "/api/product-launch-tracker/optimized";
const SUCCESS_MESSAGE = "저장이 완료되었습니다.";
const CONCURRENT_UPDATE_CODE = "PRODUCT_LAUNCH_TRACKER_CONCURRENT_UPDATE";
const RETRY_DELAYS_MS = [180, 420];
const VERIFY_DELAYS_MS = [120, 320, 760];
const SAVE_ARM_WINDOW_MS = 2_000;
const OPTION_BARCODE_NO_PATTERN = /^\d{12}$/;
const EDITABLE_ITEM_KEYS = [
  "workBatch",
  "warehouseLocation",
  "barcode",
  "modelNumber",
  "productName",
  "shoplingCategory",
  "selfCodeBase",
  "notes",
  "orderOptions",
  "chinaProductLinks",
  "detailPageAsset",
  "stages",
];

let detailSaveArmedUntil = 0;
let successPopupTimer = null;

installManualDetailSaveStability();

function installManualDetailSaveStability() {
  if (window.__commerceOsManualDetailSaveStabilityInstalled) return;
  window.__commerceOsManualDetailSaveStabilityInstalled = true;

  installPopupStyles();
  prepareDetailStageBeforeSubmit();
  installOptimizedMutationGuard();
  normalizeSuccessToast();
}

function prepareDetailStageBeforeSubmit() {
  const form = document.querySelector("#detail-form");
  if (!form) return;

  form.addEventListener(
    "submit",
    (event) => {
      const submitter = event.submitter;
      if (!(submitter instanceof HTMLButtonElement) || submitter.value !== "save") return;

      detailSaveArmedUntil = performance.now() + SAVE_ARM_WINDOW_MS;
      if (!hasCompleteManualDetailAsset(readFormAsset(form))) return;

      const stageStatus = form.querySelector('[name="stage.detailPage.status"]');
      if (stageStatus instanceof HTMLSelectElement) stageStatus.value = "완료";
    },
    true,
  );
}

function installOptimizedMutationGuard() {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = resolveUrl(input);
    const method = String(init?.method || "GET").toUpperCase();
    if (!url || url.pathname !== OPTIMIZED_API_PATH || method !== "PATCH") {
      return nativeFetch(input, init);
    }

    const originalPayload = parseJsonBody(init?.body);
    const armed = performance.now() <= detailSaveArmedUntil;
    if (
      !armed ||
      originalPayload?.operation !== "replace_item" ||
      !isRecord(originalPayload.item)
    ) {
      return nativeFetch(input, init);
    }
    detailSaveArmedUntil = 0;

    const stabilizedPayload = buildPartialMutation(originalPayload);
    const stabilizedInit = {
      ...init,
      body: JSON.stringify(stabilizedPayload),
    };

    let response = await sendWithConcurrentRetry(nativeFetch, input, stabilizedInit);
    if (!response.ok) return response;
    const responseBody = await response.clone().json().catch(() => ({}));
    if (responseBody?.ok !== true) return response;

    const expectedOptions = Array.isArray(stabilizedPayload.patch?.orderOptions)
      ? stabilizedPayload.patch.orderOptions
      : [];
    const itemId = String(stabilizedPayload.itemId || "").trim();
    let verification = await verifyPersistedOptions(nativeFetch, itemId, expectedOptions);

    if (!verification.ok && itemId && expectedOptions.length) {
      const correctivePayload = {
        operation: "patch_item",
        itemId,
        patch: { orderOptions: expectedOptions },
        updatedBy: "승준 · 상품출시진행관리 수동 가격 재확인",
      };
      const corrective = await sendWithConcurrentRetry(nativeFetch, OPTIMIZED_API_PATH, {
        method: "PATCH",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify(correctivePayload),
      });
      if (!corrective.ok) return corrective;
      const correctiveBody = await corrective.clone().json().catch(() => ({}));
      if (correctiveBody?.ok !== true) return corrective;
      verification = await verifyPersistedOptions(nativeFetch, itemId, expectedOptions);
      response = corrective;
    }

    if (!verification.ok) {
      return jsonErrorResponse(
        409,
        `저장 확인 실패 · ${verification.message || "기준판매가·원가가 서버 저장본과 일치하지 않습니다."}`,
      );
    }

    showVerifiedSavePopup(expectedOptions);
    return response;
  };
}

async function sendWithConcurrentRetry(nativeFetch, input, init) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    const response = await nativeFetch(input, init);
    if (response.status !== 409 || attempt >= RETRY_DELAYS_MS.length) return response;

    const body = await response.clone().json().catch(() => ({}));
    if (body?.code !== CONCURRENT_UPDATE_CODE) return response;
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
  return nativeFetch(input, init);
}

function buildPartialMutation(payload) {
  const item = payload.item;
  const patch = {};
  for (const key of EDITABLE_ITEM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(item, key)) patch[key] = item[key];
  }

  const domOptions = readDomOrderOptions();
  if (domOptions.length) {
    const sourceOptions = Array.isArray(item.orderOptions) ? item.orderOptions : [];
    patch.orderOptions = domOptions.map((option, index) => {
      const sourceOption = isRecord(sourceOptions[index]) ? sourceOptions[index] : {};
      return {
        ...sourceOption,
        ...option,
        id: String(sourceOption.id || option.id || `option-${index + 1}`).trim(),
      };
    });
  }

  const asset = normalizeManualDetailAsset(patch.detailPageAsset);
  if (hasCompleteManualDetailAsset(asset)) {
    const now = new Date().toISOString();
    const stages = isRecord(patch.stages) ? { ...patch.stages } : {};
    const detailStage = isRecord(stages.detailPage) ? stages.detailPage : {};
    const detailImageUrl = cleanHttpUrl(asset.detailImageUrl) || extractFirstImageUrl(asset.html);

    patch.detailPageAsset = {
      ...asset,
      status: "ready",
      detailImageUrl,
      syncedAt: now,
    };
    patch.stages = {
      ...stages,
      detailPage: {
        ...detailStage,
        status: "완료",
        completedAt: detailStage.completedAt || now,
        note: detailStage.note || "상세페이지 수동 저장 완료",
      },
    };
  }

  return {
    operation: "patch_item",
    itemId: String(payload.itemId || item.id || "").trim(),
    patch,
    updatedBy: "승준 · 상품출시진행관리 수동 저장",
  };
}

function readDomOrderOptions() {
  const rows = [...document.querySelectorAll("#detail-options tr[data-option-index]")];
  return rows.map((row, index) => {
    const read = (field) => {
      const input = row.querySelector(`[data-field="${field}"]`);
      return input instanceof HTMLInputElement ? input.value.trim() : "";
    };
    const optionBarcodeNo = read("optionBarcodeNo");
    return {
      id: String(row.dataset.optionId || "").trim(),
      optionName: read("optionName") || "옵션",
      saleOption: read("saleOption"),
      barcode: read("barcode").toUpperCase().replace(/\s+/g, ""),
      ...(OPTION_BARCODE_NO_PATTERN.test(optionBarcodeNo) ? { optionBarcodeNo } : {}),
      baseSalePriceKrw: nonNegativeInteger(read("baseSalePriceKrw")),
      unitCostKrw: nonNegativeInteger(read("unitCostKrw")),
    };
  });
}

async function verifyPersistedOptions(nativeFetch, itemId, expectedOptions) {
  if (!itemId || !expectedOptions.length) return { ok: true, message: "가격 검증 대상 없음" };
  let lastMessage = "";
  for (const delay of VERIFY_DELAYS_MS) {
    await sleep(delay);
    try {
      const item = await fetchItem(nativeFetch, itemId);
      const actualOptions = Array.isArray(item?.orderOptions) ? item.orderOptions : [];
      const result = compareOrderOptions(expectedOptions, actualOptions);
      if (result.ok) return result;
      lastMessage = result.message;
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : "상품 재조회 실패";
    }
  }
  return { ok: false, message: lastMessage };
}

async function fetchItem(nativeFetch, itemId) {
  const query = new URLSearchParams({ mode: "item", id: String(itemId) });
  const response = await nativeFetch(`${OPTIMIZED_API_PATH}?${query.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true || !body?.item) {
    throw new Error(body?.message || `상품 재조회 실패 (${response.status})`);
  }
  return body.item;
}

function compareOrderOptions(expected, actual) {
  if (expected.length !== actual.length) {
    return { ok: false, message: `옵션 개수가 다릅니다. 입력 ${expected.length}개 / 저장 ${actual.length}개` };
  }
  for (let index = 0; index < expected.length; index += 1) {
    const left = expected[index] || {};
    const right = findMatchingOption(actual, left, index) || {};
    if (normalizeText(left.barcode) !== normalizeText(right.barcode)) {
      return { ok: false, message: `옵션 ${index + 1} B코드가 서버 저장본과 다릅니다.` };
    }
    if (normalizeText(left.saleOption) !== normalizeText(right.saleOption)) {
      return { ok: false, message: `옵션 ${index + 1} 옵션값이 서버 저장본과 다릅니다.` };
    }
    if (Number(left.baseSalePriceKrw || 0) !== Number(right.baseSalePriceKrw || 0)) {
      return { ok: false, message: `옵션 ${index + 1} 기준판매가가 서버 저장본과 다릅니다.` };
    }
    if (Number(left.unitCostKrw || 0) !== Number(right.unitCostKrw || 0)) {
      return { ok: false, message: `옵션 ${index + 1} 원가가 서버 저장본과 다릅니다.` };
    }
  }
  return { ok: true, message: "기준판매가·원가 서버 저장 확인 완료" };
}

function findMatchingOption(options, expected, index) {
  const id = String(expected?.id || "").trim();
  const barcode = normalizeText(expected?.barcode);
  return (
    options.find((option) => id && String(option?.id || "").trim() === id) ||
    options.find((option) => barcode && normalizeText(option?.barcode) === barcode) ||
    options[index] ||
    null
  );
}

function installPopupStyles() {
  if (document.querySelector("#manual-detail-save-popup-style")) return;
  const style = document.createElement("style");
  style.id = "manual-detail-save-popup-style";
  style.textContent = `
    #manual-detail-save-popup {
      position: fixed;
      top: 28px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      min-width: 320px;
      max-width: min(560px, calc(100vw - 32px));
      border: 1px solid #86efac;
      border-radius: 16px;
      padding: 16px 20px;
      background: #ecfdf5;
      color: #064e3b;
      box-shadow: 0 20px 48px rgba(15, 23, 42, .24);
      font: 800 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: center;
    }
    #manual-detail-save-popup strong { display: block; font-size: 17px; }
    #manual-detail-save-popup span { display: block; margin-top: 3px; font-size: 12px; font-weight: 700; color: #047857; }
  `;
  document.head.append(style);
}

function showVerifiedSavePopup(options) {
  window.clearTimeout(successPopupTimer);
  document.querySelector("#manual-detail-save-popup")?.remove();
  const popup = document.createElement("div");
  popup.id = "manual-detail-save-popup";
  popup.setAttribute("role", "status");
  popup.setAttribute("aria-live", "polite");
  const priced = options.filter(
    (option) => Number(option.baseSalePriceKrw || 0) > 0 || Number(option.unitCostKrw || 0) > 0,
  ).length;
  popup.innerHTML = `
    <strong>✓ 저장 완료</strong>
    <span>${priced ? `기준판매가·원가 ${priced}개 옵션 서버 반영 확인` : "상품 상세 서버 반영 확인"}</span>
  `;
  document.body.append(popup);
  successPopupTimer = window.setTimeout(() => popup.remove(), 2_800);
}

function normalizeSuccessToast() {
  const toast = document.querySelector("#toast");
  if (!toast) return;

  const normalize = () => {
    if (toast.textContent?.trim() === "상품 기록을 저장했습니다.") {
      toast.textContent = SUCCESS_MESSAGE;
    }
  };
  normalize();

  const observer = new MutationObserver(normalize);
  observer.observe(toast, { childList: true, characterData: true, subtree: true });
  window.addEventListener(
    "pagehide",
    () => observer.disconnect(),
    { once: true },
  );
}

function readFormAsset(form) {
  const data = new FormData(form);
  return {
    html: String(data.get("detailHtml") || ""),
    mainImageUrl: String(data.get("mainImageUrl") || "").trim(),
    additionalImageUrls: splitLines(data.get("additionalImageUrls")),
  };
}

function normalizeManualDetailAsset(value) {
  const asset = isRecord(value) ? value : {};
  return {
    ...asset,
    html: String(asset.html || ""),
    mainImageUrl: String(asset.mainImageUrl || "").trim(),
    detailImageUrl: String(asset.detailImageUrl || "").trim(),
    additionalImageUrls: Array.isArray(asset.additionalImageUrls)
      ? asset.additionalImageUrls.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 10)
      : [],
  };
}

function hasCompleteManualDetailAsset(asset) {
  return Boolean(
    String(asset?.html || "").trim() &&
      cleanHttpUrl(asset?.mainImageUrl) &&
      Array.isArray(asset?.additionalImageUrls) &&
      asset.additionalImageUrls.some((url) => cleanHttpUrl(url)),
  );
}

function extractFirstImageUrl(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");
  const src = template.content.querySelector("img[src]")?.getAttribute("src") || "";
  return cleanHttpUrl(src);
}

function cleanHttpUrl(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate, window.location.origin);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function splitLines(value) {
  return String(value || "")
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function resolveUrl(input) {
  try {
    if (typeof input === "string" || input instanceof URL) {
      return new URL(String(input), window.location.origin);
    }
    return input instanceof Request ? new URL(input.url) : null;
  } catch {
    return null;
  }
}

function parseJsonBody(value) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function nonNegativeInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.ceil(numeric)) : 0;
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim().toUpperCase();
}

function jsonErrorResponse(status, message) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

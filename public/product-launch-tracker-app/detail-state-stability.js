const OPTIMIZED_PATH = "/api/product-launch-tracker/optimized";
const OPTION_BARCODE_PATTERN = /^\d{12}$/;
const DETAIL_BUTTON_SELECTOR = "button[data-action='detail']";
const VERIFY_DELAYS = [90, 260, 700];
const MANUAL_SAVE_UPDATED_BY = "승준 · 상품출시진행관리 수동 저장";

let installed = false;
let originalFetch = null;
let latestDetailItemId = "";
let detailGeneration = 0;
let readyTimer = null;

export function installProductLaunchDetailStability() {
  if (installed) return;
  installed = true;
  originalFetch = window.fetch.bind(window);
  installFetchAuthority();
  document.addEventListener("pointerdown", onDetailPointerDown, true);
  const dialog = document.querySelector("#detail-dialog");
  dialog?.addEventListener("close", onDetailClose);
  window.addEventListener(
    "pagehide",
    () => {
      window.clearTimeout(readyTimer);
      document.removeEventListener("pointerdown", onDetailPointerDown, true);
      dialog?.removeEventListener("close", onDetailClose);
    },
    { once: true },
  );
}

function onDetailPointerDown(event) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest(DETAIL_BUTTON_SELECTOR);
  if (!button) return;
  const row = button.closest("tr[data-id]");
  const itemId = String(row?.dataset.id || "").trim();
  if (!itemId) return;
  latestDetailItemId = itemId;
  detailGeneration += 1;
  prepareDetailLoading(itemId, detailGeneration);
}

function onDetailClose() {
  latestDetailItemId = "";
  detailGeneration += 1;
  window.clearTimeout(readyTimer);
  const form = document.querySelector("#detail-form");
  form?.removeAttribute("aria-busy");
}

function prepareDetailLoading(itemId, generation) {
  const dialog = document.querySelector("#detail-dialog");
  const form = document.querySelector("#detail-form");
  const title = document.querySelector("#detail-dialog-title");
  const options = document.querySelector("#detail-options");
  const stages = document.querySelector("#detail-stages");
  const source = document.querySelector("#detail-source");
  const sync = document.querySelector("#china-sync-status");
  const save = document.querySelector(".detail-floating-save");

  if (form) {
    form.setAttribute("aria-busy", "true");
    form.dataset.expectedItemId = itemId;
    for (const field of form.querySelectorAll("input[name], textarea[name]")) {
      if (field instanceof HTMLInputElement) {
        if (["button", "submit", "hidden"].includes(field.type)) {
          if (field.name === "id") field.value = "";
          continue;
        }
        field.value = "";
      } else if (field instanceof HTMLTextAreaElement) {
        field.value = "";
      }
    }
  }
  if (title) title.textContent = "상품 불러오는 중…";
  if (options) {
    options.innerHTML = '<tr><td colspan="7" class="option-empty">상품 옵션을 불러오는 중…</td></tr>';
  }
  if (stages) stages.innerHTML = "";
  if (source) source.innerHTML = "";
  if (sync) sync.textContent = "상품 상세 확인 중";
  if (save instanceof HTMLButtonElement) save.disabled = true;

  if (dialog && !dialog.open) {
    dialog.dataset.loadingItemId = itemId;
  }
  watchDetailReady(itemId, generation, 0);
}

function watchDetailReady(itemId, generation, attempt) {
  window.clearTimeout(readyTimer);
  readyTimer = window.setTimeout(() => {
    if (generation !== detailGeneration || itemId !== latestDetailItemId) return;
    const dialog = document.querySelector("#detail-dialog");
    const form = document.querySelector("#detail-form");
    const save = document.querySelector(".detail-floating-save");
    const currentId = String(form?.elements?.id?.value || "").trim();
    const loading = form?.classList.contains("is-loading-detail");
    if (dialog?.open && currentId === itemId && !loading) {
      form?.setAttribute("aria-busy", "false");
      if (save instanceof HTMLButtonElement) save.disabled = false;
      return;
    }
    if (attempt < 80) watchDetailReady(itemId, generation, attempt + 1);
  }, attempt < 10 ? 60 : 120);
}

function installFetchAuthority() {
  window.fetch = async function commerceProductLaunchStableFetch(input, init = {}) {
    const request = input instanceof Request ? input : null;
    const method = String(init.method || request?.method || "GET").toUpperCase();
    const url = new URL(request?.url || String(input), window.location.href);

    if (isDetailItemRead(url, method)) {
      const requestedItemId = String(url.searchParams.get("id") || "").trim();
      const generationAtRequest = detailGeneration;
      const response = await originalFetch(input, init);
      if (
        latestDetailItemId &&
        requestedItemId &&
        requestedItemId !== latestDetailItemId &&
        generationAtRequest !== detailGeneration
      ) {
        return fetchAuthoritativeItemResponse(latestDetailItemId, init.signal);
      }
      return response;
    }

    const mutation = readMutation(url, method, init.body);
    if (mutation?.operation === "replace_item" && mutation.itemId && mutation.item) {
      const enrichedMutation = await enrichReplaceMutation(mutation);
      const nextInit = { ...init, body: JSON.stringify(enrichedMutation) };
      const response = await originalFetch(input, nextInit);
      if (!response.ok) return response;
      const responseBody = await response.clone().json().catch(() => ({}));
      if (responseBody?.ok !== true) return response;

      const verification = await verifyPersistedItem(
        enrichedMutation.itemId,
        enrichedMutation.item,
      );
      if (!verification.ok) {
        return jsonErrorResponse(
          409,
          `저장 확인 실패 · ${verification.message || "서버 재조회 값이 저장 내용과 일치하지 않습니다."}`,
        );
      }
      return response;
    }

    if (isManualDetailPatch(mutation)) {
      const enrichedMutation = await enrichManualPatchMutation(mutation);
      const nextInit = { ...init, body: JSON.stringify(enrichedMutation) };
      const response = await originalFetch(input, nextInit);
      if (!response.ok) return response;
      const responseBody = await response.clone().json().catch(() => ({}));
      if (responseBody?.ok !== true) return response;

      const verification = await verifyPersistedPatch(
        enrichedMutation.itemId,
        enrichedMutation.patch,
      );
      if (!verification.ok) {
        return jsonErrorResponse(
          409,
          `저장 확인 실패 · ${verification.message || "서버 재조회 값이 저장 내용과 일치하지 않습니다."}`,
        );
      }
      return response;
    }

    return originalFetch(input, init);
  };
}

function isDetailItemRead(url, method) {
  return (
    method === "GET" &&
    url.origin === window.location.origin &&
    url.pathname === OPTIMIZED_PATH &&
    url.searchParams.get("mode") === "item" &&
    Boolean(url.searchParams.get("id"))
  );
}

function readMutation(url, method, body) {
  if (
    method !== "PATCH" ||
    url.origin !== window.location.origin ||
    url.pathname !== OPTIMIZED_PATH ||
    typeof body !== "string"
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isManualDetailPatch(mutation) {
  return Boolean(
    mutation?.operation === "patch_item" &&
      mutation.itemId &&
      mutation.updatedBy === MANUAL_SAVE_UPDATED_BY &&
      mutation.patch &&
      typeof mutation.patch === "object" &&
      !Array.isArray(mutation.patch),
  );
}

async function enrichReplaceMutation(mutation) {
  const expected = mutation.item && typeof mutation.item === "object" ? mutation.item : {};
  const current = await fetchAuthoritativeItem(mutation.itemId).catch(() => null);
  const orderOptions = enrichOrderOptions(expected.orderOptions, current?.orderOptions);

  return {
    ...mutation,
    item: {
      ...expected,
      orderOptions,
    },
  };
}

async function enrichManualPatchMutation(mutation) {
  const patch = mutation.patch && typeof mutation.patch === "object" ? mutation.patch : {};
  if (!Array.isArray(patch.orderOptions)) return mutation;

  const current = await fetchAuthoritativeItem(mutation.itemId).catch(() => null);
  return {
    ...mutation,
    patch: {
      ...patch,
      orderOptions: enrichOrderOptions(patch.orderOptions, current?.orderOptions),
    },
  };
}

function enrichOrderOptions(expectedOptionsInput, currentOptionsInput) {
  const domOptions = readDomOptions();
  const currentOptions = Array.isArray(currentOptionsInput) ? currentOptionsInput : [];
  const expectedOptions = Array.isArray(expectedOptionsInput) ? expectedOptionsInput : [];

  return expectedOptions.map((option, index) => {
    const source = option && typeof option === "object" ? option : {};
    const currentMatch = findMatchingOption(currentOptions, source, index);
    const domMatch = domOptions[index] || {};
    const optionBarcodeNo = firstValidOptionBarcode(
      source.optionBarcodeNo,
      domMatch.optionBarcodeNo,
      currentMatch?.optionBarcodeNo,
    );
    return {
      ...currentMatch,
      ...source,
      optionBarcodeNo,
      optionBarcodeIdentityKey:
        source.optionBarcodeIdentityKey || currentMatch?.optionBarcodeIdentityKey || "",
      optionBarcodeIdentityKind:
        source.optionBarcodeIdentityKind || currentMatch?.optionBarcodeIdentityKind || "",
    };
  });
}

function readDomOptions() {
  return [...document.querySelectorAll("#detail-options tr[data-option-index]")].map((row) => {
    const read = (field) => {
      const input = row.querySelector(`[data-field="${field}"]`);
      return input instanceof HTMLInputElement ? input.value.trim() : "";
    };
    return {
      optionBarcodeNo: read("optionBarcodeNo"),
    };
  });
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

function firstValidOptionBarcode(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (OPTION_BARCODE_PATTERN.test(normalized)) return normalized;
  }
  return "";
}

async function verifyPersistedItem(itemId, expected) {
  return verifyPersisted(itemId, (actual) => compareEditableItem(expected, actual));
}

async function verifyPersistedPatch(itemId, expectedPatch) {
  return verifyPersisted(itemId, (actual) => comparePatchedItem(expectedPatch, actual));
}

async function verifyPersisted(itemId, compare) {
  let lastMessage = "";
  for (const delay of VERIFY_DELAYS) {
    await wait(delay);
    try {
      const actual = await fetchAuthoritativeItem(itemId);
      const result = compare(actual);
      if (result.ok) return result;
      lastMessage = result.message;
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : "저장 재조회 실패";
    }
  }
  return { ok: false, message: lastMessage };
}

function compareEditableItem(expected, actual) {
  if (!actual || typeof actual !== "object") {
    return { ok: false, message: "저장된 상품을 다시 읽지 못했습니다." };
  }
  const fields = [
    "workBatch",
    "warehouseLocation",
    "barcode",
    "modelNumber",
    "productName",
    "shoplingCategory",
    "selfCodeBase",
    "notes",
  ];
  for (const field of fields) {
    if (normalizeText(expected?.[field]) !== normalizeText(actual?.[field])) {
      return { ok: false, message: `${field} 값이 서버 저장본과 다릅니다.` };
    }
  }

  return compareOrderOptions(expected?.orderOptions, actual?.orderOptions);
}

function comparePatchedItem(expectedPatch, actual) {
  if (!actual || typeof actual !== "object") {
    return { ok: false, message: "저장된 상품을 다시 읽지 못했습니다." };
  }

  const textFields = [
    "workBatch",
    "warehouseLocation",
    "barcode",
    "modelNumber",
    "productName",
    "shoplingCategory",
    "selfCodeBase",
    "notes",
  ];
  for (const field of textFields) {
    if (!Object.prototype.hasOwnProperty.call(expectedPatch, field)) continue;
    if (normalizeText(expectedPatch[field]) !== normalizeText(actual[field])) {
      return { ok: false, message: `${field} 값이 서버 저장본과 다릅니다.` };
    }
  }

  if (Object.prototype.hasOwnProperty.call(expectedPatch, "orderOptions")) {
    const optionResult = compareOrderOptions(expectedPatch.orderOptions, actual.orderOptions);
    if (!optionResult.ok) return optionResult;
  }

  if (Object.prototype.hasOwnProperty.call(expectedPatch, "chinaProductLinks")) {
    const expectedLinks = normalizeStringArray(expectedPatch.chinaProductLinks);
    const actualLinks = normalizeStringArray(actual.chinaProductLinks);
    if (!sameStringArray(expectedLinks, actualLinks)) {
      return { ok: false, message: "중국 상품 링크 저장값이 다릅니다." };
    }
  }

  if (Object.prototype.hasOwnProperty.call(expectedPatch, "detailPageAsset")) {
    const expectedAsset = expectedPatch.detailPageAsset || {};
    const actualAsset = actual.detailPageAsset || {};
    for (const field of ["html", "mainImageUrl", "detailImageUrl", "status"]) {
      if (normalizeText(expectedAsset[field]) !== normalizeText(actualAsset[field])) {
        return { ok: false, message: `상세페이지 ${field} 저장값이 다릅니다.` };
      }
    }
    const expectedImages = normalizeStringArray(expectedAsset.additionalImageUrls);
    const actualImages = normalizeStringArray(actualAsset.additionalImageUrls);
    if (!sameStringArray(expectedImages, actualImages)) {
      return { ok: false, message: "상세페이지 부가이미지 저장값이 다릅니다." };
    }
  }

  if (Object.prototype.hasOwnProperty.call(expectedPatch, "stages")) {
    const expectedDetailStage = expectedPatch.stages?.detailPage;
    if (expectedDetailStage && typeof expectedDetailStage === "object") {
      const actualDetailStage = actual.stages?.detailPage || {};
      for (const field of ["status", "completedAt", "note"]) {
        if (
          Object.prototype.hasOwnProperty.call(expectedDetailStage, field) &&
          normalizeText(expectedDetailStage[field]) !== normalizeText(actualDetailStage[field])
        ) {
          return { ok: false, message: `상세페이지 단계 ${field} 저장값이 다릅니다.` };
        }
      }
    }
  }

  return { ok: true, message: "저장 확인 완료" };
}

function compareOrderOptions(expectedInput, actualInput) {
  const expectedOptions = Array.isArray(expectedInput) ? expectedInput : [];
  const actualOptions = Array.isArray(actualInput) ? actualInput : [];
  if (expectedOptions.length !== actualOptions.length) {
    return { ok: false, message: "옵션 개수가 서버 저장본과 다릅니다." };
  }
  for (let index = 0; index < expectedOptions.length; index += 1) {
    const left = expectedOptions[index] || {};
    const right = findMatchingOption(actualOptions, left, index) || {};
    for (const field of ["optionName", "saleOption", "chinaOption", "barcode"]) {
      if (normalizeText(left[field]) !== normalizeText(right[field])) {
        return { ok: false, message: `옵션 ${index + 1}의 ${field} 저장값이 다릅니다.` };
      }
    }
    for (const field of ["baseSalePriceKrw", "unitCostKrw"]) {
      if (Number(left[field] || 0) !== Number(right[field] || 0)) {
        return { ok: false, message: `옵션 ${index + 1}의 ${field} 저장값이 다릅니다.` };
      }
    }
    const expectedBarcodeNo = String(left.optionBarcodeNo || "").trim();
    const actualBarcodeNo = String(right.optionBarcodeNo || "").trim();
    if (
      OPTION_BARCODE_PATTERN.test(expectedBarcodeNo) &&
      expectedBarcodeNo !== actualBarcodeNo
    ) {
      return { ok: false, message: `옵션 ${index + 1}의 옵션바코드NO가 다릅니다.` };
    }
  }
  return { ok: true, message: "저장 확인 완료" };
}

async function fetchAuthoritativeItem(itemId) {
  const response = await fetchAuthoritativeItemResponse(itemId);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true || !body?.item) {
    throw new Error(body?.message || `상품 재조회 실패 (${response.status})`);
  }
  return body.item;
}

function fetchAuthoritativeItemResponse(itemId, signal) {
  const query = new URLSearchParams({ mode: "item", id: String(itemId) });
  return originalFetch(`${OPTIMIZED_PATH}?${query.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    ...(signal ? { signal } : {}),
  });
}

function jsonErrorResponse(status, message) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map((entry) => normalizeText(entry)).filter(Boolean) : [];
}

function sameStringArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

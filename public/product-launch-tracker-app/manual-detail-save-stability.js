const OPTIMIZED_API_PATH = "/api/product-launch-tracker/optimized";
const SUCCESS_MESSAGE = "저장이 완료되었습니다.";
const SAVE_ARM_WINDOW_MS = 2_000;
const MANUAL_SAVE_UPDATED_BY = "승준 · 상품출시진행관리 수동 저장";
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

installManualDetailSaveStability();

function installManualDetailSaveStability() {
  if (window.__commerceOsManualDetailSaveStabilityInstalled) return;
  window.__commerceOsManualDetailSaveStabilityInstalled = true;

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
    return nativeFetch(input, {
      ...init,
      body: JSON.stringify(stabilizedPayload),
    });
  };
}

function buildPartialMutation(payload) {
  const item = payload.item;
  const patch = {};
  for (const key of EDITABLE_ITEM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(item, key)) patch[key] = item[key];
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
    updatedBy: MANUAL_SAVE_UPDATED_BY,
  };
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

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

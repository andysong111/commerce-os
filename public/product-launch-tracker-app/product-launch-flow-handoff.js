import {
  buildProductLaunchFlowHandoff,
  hasCompleteShoplingRegistration,
  PRODUCT_LAUNCH_SIMPLE_SESSION_KEY,
  PRODUCT_LAUNCH_TRACKER_HANDOFF_KEY,
} from "./lib/product-launch-flow-handoff.mjs";

const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const TRACKER_STATE_ENDPOINT = "/api/product-launch-tracker/state";
const previewDialog = document.querySelector("#preview-dialog");
const detailForm = document.querySelector("#detail-form");
const previewActions = previewDialog?.querySelector(".dialog-actions");
let currentItemId = "";
let handoffBusy = false;

const previewContinueButton = document.createElement("button");
previewContinueButton.id = "continue-product-launch-flow-button";
previewContinueButton.type = "button";
previewContinueButton.className = "button button-secondary";
previewContinueButton.textContent = "상품명·키워드 이어가기";
previewContinueButton.hidden = true;
previewContinueButton.addEventListener("click", () => {
  void startHandoff(currentItemId, previewContinueButton);
});

if (previewActions) {
  const confirmButton = previewActions.querySelector("button[value='cancel']");
  previewActions.insertBefore(previewContinueButton, confirmButton ?? null);
}

document.addEventListener(
  "click",
  (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const row = target?.closest("tr[data-id]");
    if (target?.closest("button[data-action='detail']")) {
      currentItemId = row?.dataset.id ?? "";
      window.setTimeout(() => decorateDetailPanel(currentItemId), 0);
    }
    if (target?.closest("button[data-action='preview']")) {
      currentItemId = row?.dataset.id ?? "";
      window.setTimeout(refreshPreviewButton, 0);
    }
    if (target?.closest("#preview-button")) {
      currentItemId = detailForm?.elements?.id?.value ?? "";
      window.setTimeout(refreshPreviewButton, 0);
    }
  },
  true,
);

previewDialog?.addEventListener("close", () => {
  previewContinueButton.hidden = true;
});

const observer = new MutationObserver(() => {
  if (currentItemId) decorateDetailPanel(currentItemId);
});
observer.observe(document.body, { childList: true, subtree: true });

function refreshPreviewButton() {
  const item = readTrackerItem(currentItemId);
  const complete = hasCompleteShoplingRegistration(item);
  previewContinueButton.hidden = !complete;
  previewContinueButton.disabled = !complete || handoffBusy;
}

function decorateDetailPanel(itemId) {
  const panel = document.querySelector("#shopling-registration-result-panel");
  if (!panel || panel.dataset.handoffReady === "true") return;
  const item = readTrackerItem(itemId);
  if (!hasCompleteShoplingRegistration(item)) return;

  panel.dataset.handoffReady = "true";
  const titleRow = panel.querySelector(".section-title-row");
  if (!titleRow) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button-secondary";
  button.textContent = "상품명·키워드 이어가기";
  button.addEventListener("click", () => void startHandoff(itemId, button));
  titleRow.append(button);
}

async function startHandoff(itemId, button) {
  if (handoffBusy) return;
  const item = readTrackerItem(itemId);
  if (!item) {
    showToast("진행관리 상품을 찾지 못했습니다.");
    return;
  }

  let payload;
  try {
    payload = buildProductLaunchFlowHandoff(item);
  } catch (error) {
    showToast(
      error instanceof Error
        ? error.message
        : "상품명·키워드 단계로 이어갈 수 없습니다.",
    );
    return;
  }

  handoffBusy = true;
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "연결 중...";
  try {
    const trackerState = markPriceKeywordInProgress(itemId);
    localStorage.setItem(
      PRODUCT_LAUNCH_SIMPLE_SESSION_KEY,
      JSON.stringify(payload.session),
    );
    localStorage.setItem(
      PRODUCT_LAUNCH_TRACKER_HANDOFF_KEY,
      JSON.stringify(payload.handoff),
    );
    if (trackerState) await saveTrackerState(trackerState);
    window.location.assign("/product-launch-flow");
  } catch (error) {
    console.error(error);
    handoffBusy = false;
    button.disabled = false;
    button.textContent = originalText;
    showToast(
      error instanceof Error
        ? error.message
        : "상품출시플로우 연결을 시작하지 못했습니다.",
    );
  }
}

function markPriceKeywordInProgress(itemId) {
  const state = readTrackerState();
  if (!state) return null;
  const items = Array.isArray(state.items) ? state.items : [];
  const item = items.find((candidate) => String(candidate?.id ?? "") === itemId);
  if (!item) return state;

  const now = new Date().toISOString();
  item.stages = item.stages && typeof item.stages === "object" ? item.stages : {};
  item.stages.priceKeyword = {
    ...(item.stages.priceKeyword ?? {}),
    status: "진행 중",
    completedAt: null,
    note: "등록된 goods_key 6개로 상품명·검색어 작업을 시작했습니다.",
  };
  item.updatedAt = now;
  item.updatedBy = "상품출시플로우 연결";
  state.savedAt = now;
  localStorage.setItem(TRACKER_STORAGE_KEY, JSON.stringify(state));
  return state;
}

async function saveTrackerState(state) {
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
    throw new Error(body?.message || "진행관리 상태를 서버에 저장하지 못했습니다.");
  }
}

function readTrackerItem(itemId) {
  const state = readTrackerState();
  const items = Array.isArray(state?.items) ? state.items : [];
  return items.find((item) => String(item?.id ?? "") === itemId) ?? null;
}

function readTrackerState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRACKER_STORAGE_KEY) ?? "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
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
  }, 3500);
}

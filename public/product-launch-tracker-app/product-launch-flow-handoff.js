import {
  buildProductLaunchFlowHandoff,
  hasCompleteShoplingRegistration,
  PRODUCT_LAUNCH_SIMPLE_SESSION_KEY,
  PRODUCT_LAUNCH_TRACKER_HANDOFF_KEY,
} from "./lib/product-launch-flow-handoff.mjs";

const TRACKER_STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
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
    localStorage.setItem(
      PRODUCT_LAUNCH_SIMPLE_SESSION_KEY,
      JSON.stringify(payload.session),
    );
    localStorage.setItem(
      PRODUCT_LAUNCH_TRACKER_HANDOFF_KEY,
      JSON.stringify(payload.handoff),
    );
    // 가격·키워드는 더 이상 상품출시진행관리의 활성 단계가 아니다.
    // 과거처럼 전체 tracker state를 PUT하지 않고 전용 플로우 세션만 넘긴다.
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

const detailDialog = document.querySelector("#detail-dialog");
const detailForm = document.querySelector("#detail-form");
const saveStatus = document.querySelector("#save-status");

let pendingItemId = "";
let syncTimer = null;
let syncSerial = 0;

if (detailForm) {
  detailForm.addEventListener("submit", (event) => {
    if (event.submitter?.value !== "save") return;
    const itemId = String(detailForm.elements?.id?.value ?? "").trim();
    if (!itemId) return;
    pendingItemId = itemId;
    const serial = ++syncSerial;
    waitForMainSave(itemId, serial, 0);
  });
}

window.addEventListener("product-launch-tracker:external-state", (event) => {
  const itemId = String(event.detail?.itemId ?? "").trim();
  if (!itemId || itemId !== pendingItemId) return;
  scheduleSync(itemId, ++syncSerial, 80);
});

function waitForMainSave(itemId, serial, attempt) {
  if (serial !== syncSerial || itemId !== pendingItemId) return;
  if (attempt > 100) {
    pendingItemId = "";
    return;
  }
  window.setTimeout(() => {
    if (serial !== syncSerial || itemId !== pendingItemId) return;
    if (detailDialog?.open) {
      waitForMainSave(itemId, serial, attempt + 1);
      return;
    }
    // The B-code China-option helper may perform one final item-scoped patch after
    // the main dialog closes. Give it a short window, while its external-state
    // event can still trigger an earlier sync.
    scheduleSync(itemId, serial, 1_200);
  }, attempt < 12 ? 80 : 150);
}

function scheduleSync(itemId, serial, delay) {
  if (syncTimer) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    if (serial !== syncSerial || itemId !== pendingItemId) return;
    void syncItem(itemId, serial);
  }, delay);
}

async function syncItem(itemId, serial) {
  if (serial !== syncSerial || itemId !== pendingItemId) return;
  setStatus("상품마스터 최신 구매정보 반영 중");
  try {
    const response = await fetch(
      "/api/product-launch-tracker/item-product-master-sync",
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ itemId }),
        credentials: "same-origin",
        cache: "no-store",
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      throw new Error(
        body?.message || "상품마스터 최신 구매정보 반영에 실패했습니다.",
      );
    }
    setStatus("상품마스터 최신 구매정보까지 저장됨");
  } catch (error) {
    console.error(error);
    setStatus("상품은 저장됨 · 상품마스터 동기화 재확인 필요");
  } finally {
    if (serial === syncSerial && itemId === pendingItemId) pendingItemId = "";
  }
}

function setStatus(message) {
  if (saveStatus) saveStatus.textContent = message;
}

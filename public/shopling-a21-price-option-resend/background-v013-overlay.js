const A21_V013_STATE_KEY = "commerceOsShoplingA21PriceOptionResendV012";
const A21_V013_READY = "A21_POPUP_READY_V013";

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install" || details.reason === "update") {
    void chrome.storage.local.remove(A21_V013_STATE_KEY);
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== A21_V013_READY) return false;
  void (async () => {
    const tabId = sender?.tab?.id;
    const windowId = sender?.tab?.windowId;
    const frameId = sender?.frameId;
    if (!Number.isInteger(tabId)) return;
    const stored = await chrome.storage.local.get(A21_V013_STATE_KEY);
    const state = stored[A21_V013_STATE_KEY];
    if (!state || state.state !== "RUNNING") return;
    const job = Array.isArray(state.jobs)
      ? state.jobs.find((item) => item && item.id === message.jobId && item.status === "RUNNING")
      : null;
    if (!job || job.mode !== message.mode) return;
    job.popupTabId = tabId;
    job.popupWindowId = Number.isInteger(windowId) ? windowId : null;
    job.popupFrameId = Number.isInteger(frameId) ? frameId : 0;
    job.popupAssignmentBusy = true;
    job.popupAutoV013 = true;
    job.stage = "POPUP_CONFIG";
    job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 팝업 작업 ID 연결 완료`;
    job.updatedAt = Date.now();
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [A21_V013_STATE_KEY]: state });
  })();
  return false;
});

const A21_V013_STATE_KEY = "commerceOsShoplingA21PriceOptionResendV012";
const A21_V013_READY = "A21_POPUP_READY_V013";
const A21_SHOPLING_ORIGIN = "https://a.shopling.co.kr/";

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

// Shopling의 상품수정 송신 팝업은 환경에 따라 tabs.openerTabId가 비어 있을 수 있다.
// webNavigation은 새 팝업/탭을 만든 실제 sourceTabId를 제공하므로 병렬 작업에서도
// 판매가/옵션 Job과 정확한 송신 팝업을 일대일로 연결할 수 있다.
if (chrome.webNavigation?.onCreatedNavigationTarget) {
  chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
    void (async () => {
      if (!Number.isInteger(details?.tabId) || !Number.isInteger(details?.sourceTabId)) return;
      if (!String(details.url || "").startsWith(A21_SHOPLING_ORIGIN)) return;

      const stored = await chrome.storage.local.get(A21_V013_STATE_KEY);
      const state = stored[A21_V013_STATE_KEY];
      if (!state || state.state !== "RUNNING" || !Array.isArray(state.jobs)) return;

      const job = state.jobs.find((item) =>
        item
        && item.status === "RUNNING"
        && item.workerTabId === details.sourceTabId
        && ["POPUP_OPENING", "POPUP_CONFIG"].includes(item.stage)
        && (!Number.isInteger(item.popupTabId) || item.popupTabId === details.tabId),
      );
      if (!job) return;

      const tab = await chrome.tabs.get(details.tabId).catch(() => null);
      job.popupTabId = details.tabId;
      job.popupWindowId = Number.isInteger(tab?.windowId) ? tab.windowId : null;
      job.popupFrameId = null;
      job.popupAssignmentBusy = false;
      job.popupAutoV015 = true;
      job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 송신 팝업 생성 감지 · 로딩 대기`;
      job.updatedAt = Date.now();
      state.updatedAt = Date.now();
      await chrome.storage.local.set({ [A21_V013_STATE_KEY]: state });
    })();
  });
}

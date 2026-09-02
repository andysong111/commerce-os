const A21_V013_STATE_KEY = "commerceOsShoplingA21PriceOptionResendV012";
const A21_V013_READY = "A21_POPUP_READY_V013";
const A21_V016_CLAIM = "A21_POPUP_CLAIM_V016";

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== A21_V016_CLAIM) return false;
  void (async () => {
    const tabId = sender?.tab?.id;
    const windowId = sender?.tab?.windowId;
    const openerTabId = sender?.tab?.openerTabId;
    if (!Number.isInteger(tabId)) {
      sendResponse({ ok: false, error: "popup_tab_missing" });
      return;
    }
    const stored = await chrome.storage.local.get(A21_V013_STATE_KEY);
    const state = stored[A21_V013_STATE_KEY];
    if (!state || state.state !== "RUNNING" || !Array.isArray(state.jobs)) {
      sendResponse({ ok: false, error: "run_not_active" });
      return;
    }

    let job = state.jobs.find((item) => item?.status === "RUNNING" && item.popupTabId === tabId);
    if (!job && Number.isInteger(openerTabId)) {
      job = state.jobs.find((item) => item?.status === "RUNNING" && item.workerTabId === openerTabId && ["POPUP_OPENING", "POPUP_CONFIG", "SUBMIT_CLICKED", "RESULT_WAIT"].includes(item.stage));
    }
    if (!job) {
      const candidates = state.jobs.filter((item) => item?.status === "RUNNING" && ["POPUP_OPENING", "POPUP_CONFIG"].includes(item.stage) && !Number.isInteger(item.popupTabId));
      if (candidates.length === 1) job = candidates[0];
    }
    if (!job) {
      sendResponse({ ok: false, error: "popup_job_ambiguous" });
      return;
    }

    job.popupTabId = tabId;
    job.popupWindowId = Number.isInteger(windowId) ? windowId : null;
    job.popupFrameId = Number.isInteger(sender?.frameId) ? sender.frameId : 0;
    job.popupAssignmentBusy = true;
    job.popupAutoV016 = true;
    if (!["SUBMIT_CLICKED", "RESULT_WAIT"].includes(job.stage)) job.stage = "POPUP_CONFIG";
    job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 송신 팝업 직접 연결 완료`;
    job.updatedAt = Date.now();
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [A21_V013_STATE_KEY]: state });
    sendResponse({ ok: true, assignment: { jobId: job.id, mode: job.mode, runId: state.runId } });
  })().catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

// Shopling 팝업은 처음 about:blank로 만들어진 뒤 실제 URL로 이동할 수 있다.
// v0.1.6은 생성 시점 URL을 검사하지 않고 sourceTabId만으로 정확한 작업창과 먼저 연결한다.
if (chrome.webNavigation?.onCreatedNavigationTarget) {
  chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
    void (async () => {
      if (!Number.isInteger(details?.tabId) || !Number.isInteger(details?.sourceTabId)) return;
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
      job.popupAssignmentBusy = true;
      job.popupAutoV016 = true;
      job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 송신 팝업 생성 감지 · 직접 연결 대기`;
      job.updatedAt = Date.now();
      state.updatedAt = Date.now();
      await chrome.storage.local.set({ [A21_V013_STATE_KEY]: state });
    })();
  });
}

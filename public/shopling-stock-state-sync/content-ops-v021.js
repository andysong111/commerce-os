(() => {
  const VERSION = chrome.runtime.getManifest().version;
  const STATE_KEY = "commerceOsShoplingStockStateSyncV013";
  const READY = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY";
  const PING = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING";
  const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START";
  const RESULT = "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT";
  const PROGRESS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS";
  const STATUS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS";
  const post = (payload) => window.postMessage({ ...payload, extensionVersion: VERSION }, location.origin);
  async function announce() {
    post({ type: READY });
    const response = await chrome.runtime.sendMessage({ type: "STOCK_SYNC_GET_STATUS" }).catch(() => null);
    if (!response?.ok) return;
    let active = response.active ?? null;
    const lastResult = response.lastResult ?? null;
    const activeStartedAt = Number(active?.startedAt || 0);
    const lastFinishedAt = Number(lastResult?.finishedAt || 0);
    const staleTerminalRunning = active?.status === "RUNNING" && active?.job?.jobId === lastResult?.jobId && ["SUCCEEDED", "FAILED", "UNCERTAIN"].includes(lastResult?.outcome) && activeStartedAt > 0 && lastFinishedAt >= activeStartedAt;
    if (staleTerminalRunning) { await chrome.storage.local.remove(STATE_KEY); active = null; }
    post({ type: STATUS, active });
    if (lastResult && Date.now() - Number(lastResult.finishedAt || 0) < 3_600_000) post({ type: RESULT, ...lastResult });
  }
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === PING) { void announce(); return; }
    if (data.type !== START) return;
    void chrome.runtime.sendMessage({ type: "STOCK_SYNC_START", job: data.job }).then((response) => {
      if (response?.ok) {
        post({ type: PROGRESS, jobId: response.active?.job?.jobId || data.job?.jobId || "", stage: response.active?.stage || "STARTING", message: response.message || "Shopling 동기화 작업을 시작했습니다.", job: response.active?.job || data.job || null });
        return;
      }
      post({ type: RESULT, jobId: data.job?.jobId || "", job: data.job || null, outcome: "FAILED", message: response?.message || "Shopling 동기화 작업을 시작하지 못했습니다.", evidence: { code: response?.code || "STOCK_SYNC_START_FAILED", missing: response?.missing || [] }, finishedAt: Date.now() });
    }).catch((error) => post({ type: RESULT, jobId: data.job?.jobId || "", job: data.job || null, outcome: "FAILED", message: String(error?.message || error || "확장프로그램 통신 실패"), evidence: { code: "STOCK_SYNC_RUNTIME_MESSAGE_FAILED" }, finishedAt: Date.now() }));
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "STOCK_SYNC_PROGRESS") post({ type: PROGRESS, ...message.payload });
    if (message?.type === "STOCK_SYNC_RESULT") post({ type: RESULT, ...message.payload });
  });
  void announce();
  window.addEventListener("DOMContentLoaded", () => void announce(), { once: true });
})();

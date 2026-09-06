(() => {
  const VERSION = "0.1.9";
  const STATE_KEY = "commerceOsShoplingStockStateSyncV013";
  const READY = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_READY";
  const PING = "COMMERCE_OS_SHOPLING_STOCK_SYNC_EXTENSION_PING";
  const START = "COMMERCE_OS_SHOPLING_STOCK_SYNC_START";
  const RESULT = "COMMERCE_OS_SHOPLING_STOCK_SYNC_RESULT";
  const PROGRESS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_PROGRESS";
  const STATUS = "COMMERCE_OS_SHOPLING_STOCK_SYNC_STATUS";

  const post = (payload) => window.postMessage({ ...payload, extensionVersion: VERSION }, location.origin);

  function isTerminalOutcome(value) {
    return ["SUCCEEDED", "FAILED", "UNCERTAIN"].includes(String(value || "").toUpperCase());
  }

  async function reconcileStaleRunningState(response) {
    let active = response?.active ?? null;
    const lastResult = response?.lastResult ?? null;
    const activeStartedAt = Number(active?.startedAt || 0);
    const lastFinishedAt = Number(lastResult?.finishedAt || 0);
    const sameJob = Boolean(
      active?.job?.jobId &&
        lastResult?.jobId &&
        String(active.job.jobId) === String(lastResult.jobId),
    );
    const staleTerminalRunning = Boolean(
      active?.status === "RUNNING" &&
        sameJob &&
        isTerminalOutcome(lastResult?.outcome) &&
        activeStartedAt > 0 &&
        lastFinishedAt >= activeStartedAt,
    );

    if (staleTerminalRunning) {
      await chrome.storage.local.remove(STATE_KEY).catch(() => null);
      active = null;
    }

    return { active, lastResult, staleTerminalRunning };
  }

  const announce = async () => {
    post({ type: READY });
    const response = await chrome.runtime.sendMessage({ type: "STOCK_SYNC_GET_STATUS" }).catch(() => null);
    if (!response?.ok) return;
    const reconciled = await reconcileStaleRunningState(response);
    post({ type: STATUS, active: reconciled.active });
    if (
      reconciled.lastResult &&
      Date.now() - Number(reconciled.lastResult.finishedAt || 0) < 3_600_000
    ) {
      post({ type: RESULT, ...reconciled.lastResult });
    }
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === PING) {
      void announce();
      return;
    }
    if (data.type !== START) return;
    void chrome.runtime
      .sendMessage({ type: "STOCK_SYNC_START", job: data.job })
      .then((response) => {
        if (response?.ok) {
          post({
            type: PROGRESS,
            jobId: response.active?.job?.jobId || data.job?.jobId || "",
            stage: response.active?.stage || "STARTING",
            message: response.message || "Shopling 동기화 작업을 시작했습니다.",
            job: response.active?.job || data.job || null,
          });
          return;
        }
        post({
          type: RESULT,
          jobId: data.job?.jobId || "",
          job: data.job || null,
          outcome: "FAILED",
          message: response?.message || "Shopling 동기화 작업을 시작하지 못했습니다.",
          evidence: { code: response?.code || "STOCK_SYNC_START_FAILED" },
          finishedAt: Date.now(),
        });
      })
      .catch((error) => {
        post({
          type: RESULT,
          jobId: data.job?.jobId || "",
          job: data.job || null,
          outcome: "FAILED",
          message: String(error?.message || error || "확장프로그램 통신 실패"),
          evidence: { code: "STOCK_SYNC_RUNTIME_MESSAGE_FAILED" },
          finishedAt: Date.now(),
        });
      });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "STOCK_SYNC_PROGRESS") post({ type: PROGRESS, ...message.payload });
    if (message.type === "STOCK_SYNC_RESULT") post({ type: RESULT, ...message.payload });
  });

  void announce();
  window.addEventListener("DOMContentLoaded", () => void announce(), { once: true });
})();
importScripts("background-v030.js");

(() => {
  const VERSION = "0.3.2";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  let completionBusy = false;

  async function loadStateV032() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function saveStateV032(state) {
    if (!state) return null;
    state.version = VERSION;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  async function acceptCompletionV032(message, sender) {
    if (completionBusy) return { ok: true, skipped: true };
    completionBusy = true;
    try {
      const state = await loadStateV032();
      if (!state || state.state !== "RUNNING" || state.stopped) return { ok: true, idle: true };
      const job = state.jobs?.find((item) => item.status === "RUNNING");
      if (!job || job.stage !== "RESULT_WAIT") return { ok: true, waitingStage: job?.stage || null };
      if (message?.completion !== true || message?.processing === true) return { ok: true, completed: false };

      const tabId = sender?.tab?.id;
      if (Number.isInteger(tabId)) job.resultTabId = tabId;
      if (Number.isInteger(sender?.frameId)) job.resultFrameId = sender.frameId;
      job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 결과문서가 완료문구를 직접 보고 · 다음 단계 진행 v${VERSION}`;
      await saveStateV032(state);

      await completeJob(
        job.id,
        `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 처리 완료 · 결과문서 직접 완료신호 · 마켓 성공/실패 검증 없음 v${VERSION}`,
      );
      return { ok: true, completed: true, tabId: Number.isInteger(tabId) ? tabId : null };
    } finally {
      completionBusy = false;
    }
  }

  const baseStartRunV032 = startRun;
  startRun = async function startRunV032(sourceTabId, testMode = false) {
    const result = await baseStartRunV032(sourceTabId, testMode);
    const state = await loadStateV032();
    if (state) {
      await saveStateV032(state);
      return publicState(state);
    }
    return result;
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "A21_RESULT_COMPLETE_V032") return false;
    acceptCompletionV032(message, sender)
      .then(async (diagnostic) => {
        const state = await loadStateV032();
        sendResponse({ ok: true, diagnostic, state: state ? publicState(state) : null });
      })
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
})();

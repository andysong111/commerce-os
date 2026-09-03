importScripts("background-v032.js");

(() => {
  const VERSION = "0.3.3";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  let busy = false;

  async function loadStateV033() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function saveStateV033(state) {
    if (!state) return null;
    state.version = VERSION;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  async function acceptCompletionV033(message) {
    if (busy) return { ok: true, skipped: true };
    busy = true;
    try {
      const state = await loadStateV033();
      if (!state || state.state !== "RUNNING" || state.stopped) return { ok: true, idle: true };
      const job = state.jobs?.find((item) => item.status === "RUNNING");
      if (!job) return { ok: true, noRunningJob: true };
      if (!["SUBMIT_CLICKED", "RESULT_WAIT"].includes(String(job.stage || ""))) {
        return { ok: true, waitingStage: job.stage || null };
      }
      if (message?.completion !== true || message?.processing === true) return { ok: true, completed: false };

      job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 결과창 완료문구를 송신창 opener가 직접 확인 · 다음 단계 진행 v${VERSION}`;
      await saveStateV033(state);
      await completeJob(
        job.id,
        `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 처리 완료 · 결과창 자동 스크롤 후 완료문구 직접 확인 · 마켓 성공/실패 검증 없음 v${VERSION}`,
      );
      return { ok: true, completed: true, href: String(message?.href || "") };
    } finally {
      busy = false;
    }
  }

  const baseStartRunV033 = startRun;
  startRun = async function startRunV033(sourceTabId, testMode = false) {
    const result = await baseStartRunV033(sourceTabId, testMode);
    const state = await loadStateV033();
    if (state) {
      await saveStateV033(state);
      return publicState(state);
    }
    return result;
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "A21_RESULT_COMPLETE_V033") return false;
    acceptCompletionV033(message)
      .then(async (diagnostic) => {
        const state = await loadStateV033();
        sendResponse({ ok: true, diagnostic, state: state ? publicState(state) : null });
      })
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
})();

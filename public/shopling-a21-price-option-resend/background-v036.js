importScripts("background-v035.js");

(() => {
  const VERSION = "0.3.6";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  let completionBusy = false;

  async function loadState() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function saveState(state) {
    if (!state) return null;
    state.version = VERSION;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  async function updateRunningMessage(message, sender) {
    const state = await loadState();
    if (!state || state.state !== "RUNNING" || state.stopped) return;
    const job = state.jobs?.find((item) => item.status === "RUNNING");
    if (!job || !["SUBMIT_CLICKED", "RESULT_WAIT"].includes(String(job.stage || ""))) return;
    const snapshot = message?.snapshot || {};
    const source = String(snapshot.href || message?.frameHref || sender?.tab?.url || "about:blank");
    const kind = message.type === "A21_RESULT_LOADING_V036" ? "로딩 중" : "로딩 종료 · 안정화 중";
    job.resultTabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : job.resultTabId;
    job.resultWindowId = Number.isInteger(sender?.tab?.windowId) ? sender.tab.windowId : job.resultWindowId;
    job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 결과문서 직접 감지 · ${kind} · ${source.includes("about:blank") ? "about:blank" : "Shopling"} v${VERSION}`;
    await saveState(state);
  }

  async function acceptCompletion(message, sender) {
    if (completionBusy) return { ok: true, skipped: true };
    completionBusy = true;
    try {
      const state = await loadState();
      if (!state || state.state !== "RUNNING" || state.stopped) return { ok: true, idle: true };
      const job = state.jobs?.find((item) => item.status === "RUNNING");
      if (!job) return { ok: true, noRunningJob: true };
      if (!["SUBMIT_CLICKED", "RESULT_WAIT"].includes(String(job.stage || ""))) {
        return { ok: true, waitingStage: job.stage || null };
      }
      const snapshot = message?.snapshot || {};
      if (snapshot.resultEvidence !== true || snapshot.processing === true || snapshot.ready !== true) {
        return { ok: true, completed: false };
      }

      job.resultTabId = Number.isInteger(sender?.tab?.id) ? sender.tab.id : job.resultTabId;
      job.resultWindowId = Number.isInteger(sender?.tab?.windowId) ? sender.tab.windowId : job.resultWindowId;
      job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 결과문서가 직접 로딩 종료를 통보 · 다음 단계 진행 v${VERSION}`;
      await saveState(state);
      await completeJob(
        job.id,
        `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 완료 · 결과문서 직접 감지(about:blank 포함) · 로딩 종료 + 결과표 1.8초 안정화 · 마켓 성공/실패 검증 없음 v${VERSION}`,
      );
      return { ok: true, completed: true };
    } finally {
      completionBusy = false;
    }
  }

  const baseStartRun = startRun;
  startRun = async function startRunV036(sourceTabId, testMode = false) {
    const result = await baseStartRun(sourceTabId, testMode);
    const state = await loadState();
    if (state) {
      state.version = VERSION;
      state.resultPolicy = "DIRECT_RESULT_DOCUMENT_OBSERVER_WITH_ABOUT_BLANK_FALLBACK";
      await saveState(state);
      return publicState(state);
    }
    return result;
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!["A21_RESULT_LOADING_V036", "A21_RESULT_STABILIZING_V036", "A21_RESULT_COMPLETE_V036"].includes(String(message?.type || ""))) {
      return false;
    }

    if (message.type === "A21_RESULT_COMPLETE_V036") {
      acceptCompletion(message, sender)
        .then(async (diagnostic) => {
          const state = await loadState();
          sendResponse({ ok: true, diagnostic, state: state ? publicState(state) : null });
        })
        .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      return true;
    }

    void updateRunningMessage(message, sender);
    sendResponse({ ok: true });
    return false;
  });
})();

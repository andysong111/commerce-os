importScripts("background-v030.js");

(() => {
  const VERSION = "0.3.4";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  let completionBusy = false;

  async function loadStateV034() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function saveStateV034(state) {
    if (!state) return null;
    state.version = VERSION;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  async function closeStaleShoplingPopupWindows(sourceTabId) {
    const sourceTab = Number.isInteger(sourceTabId) ? await chrome.tabs.get(sourceTabId).catch(() => null) : null;
    const sourceWindowId = sourceTab?.windowId;
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["popup"] }).catch(() => []);
    for (const win of windows) {
      if (!Number.isInteger(win?.id) || win.id === sourceWindowId) continue;
      const shoplingish = (win.tabs || []).some((tab) => {
        const url = String(tab?.url || "");
        const title = String(tab?.title || "");
        return url.startsWith("https://a.shopling.co.kr/")
          || /샵플링|shopling/i.test(title);
      });
      if (shoplingish) await chrome.windows.remove(win.id).catch(() => null);
    }
  }

  async function acceptCompletionV034(message) {
    if (completionBusy) return { ok: true, skipped: true };
    completionBusy = true;
    try {
      const state = await loadStateV034();
      if (!state || state.state !== "RUNNING" || state.stopped) return { ok: true, idle: true };
      const job = state.jobs?.find((item) => item.status === "RUNNING");
      if (!job) return { ok: true, noRunningJob: true };
      if (!["SUBMIT_CLICKED", "RESULT_WAIT"].includes(String(job.stage || ""))) {
        return { ok: true, waitingStage: job.stage || null };
      }
      if (message?.completion !== true || message?.processing === true) return { ok: true, completed: false };

      job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 단일 결과창 완료 footer 확인 · 다음 단계 진행 v${VERSION}`;
      await saveStateV034(state);
      await completeJob(
        job.id,
        `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 완료 · form target 결과창 자동 스크롤/완료 확인 · 마켓 성공/실패 검증 없음 v${VERSION}`,
      );
      return { ok: true, completed: true, href: String(message?.href || "") };
    } finally {
      completionBusy = false;
    }
  }

  const baseStartRunV034 = startRun;
  startRun = async function startRunV034(sourceTabId, testMode = false) {
    await closeStaleShoplingPopupWindows(sourceTabId);
    const result = await baseStartRunV034(sourceTabId, testMode);
    const state = await loadStateV034();
    if (state) {
      await saveStateV034(state);
      return publicState(state);
    }
    return result;
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "A21_RESULT_COMPLETE_V034") return false;
    acceptCompletionV034(message)
      .then(async (diagnostic) => {
        const state = await loadStateV034();
        sendResponse({ ok: true, diagnostic, state: state ? publicState(state) : null });
      })
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
})();

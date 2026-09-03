importScripts("background-v030.js");

(() => {
  const VERSION = "0.3.1";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  const SHOPLING_ORIGIN = "https://a.shopling.co.kr/";
  let reconcileBusy = false;

  const isShoplingV031 = (url) => String(url || "").startsWith(SHOPLING_ORIGIN);

  async function loadStateV031() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function saveStateV031(state) {
    if (!state) return null;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  async function inspectCompletionV031(tabId) {
    try {
      return await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
          const text = norm(document.body?.innerText || document.body?.textContent || "");
          const completion = /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text)
            || /상품\s*수정\s*전송\s*완료/i.test(text);
          const processing = /처리중입니다/i.test(text)
            || /잠시만\s*기다려주시기\s*바랍니다/i.test(text);
          return { completion, processing, href: location.href, title: document.title || "" };
        },
      });
    } catch {
      return [];
    }
  }

  async function reconcileCompletionV031() {
    if (reconcileBusy) return { ok: true, skipped: true };
    reconcileBusy = true;
    try {
      const state = await loadStateV031();
      if (!state || state.state !== "RUNNING" || state.stopped) return { ok: true, idle: true };
      const job = state.jobs?.find((item) => item.status === "RUNNING");
      if (!job || job.stage !== "RESULT_WAIT") return { ok: true, waitingStage: job?.stage || null };

      const tabs = await chrome.tabs.query({});
      let completionTabId = null;
      let completionHref = "";
      let sawProcessing = false;

      for (const tab of tabs) {
        if (!Number.isInteger(tab.id) || !isShoplingV031(tab.url)) continue;
        const rows = await inspectCompletionV031(tab.id);
        for (const row of rows) {
          const result = row?.result;
          if (!result) continue;
          if (result.processing) sawProcessing = true;
          if (result.completion && !result.processing) {
            completionTabId = tab.id;
            completionHref = result.href || tab.url || "";
            break;
          }
        }
        if (Number.isInteger(completionTabId)) break;
      }

      if (Number.isInteger(completionTabId)) {
        job.resultTabId = completionTabId;
        job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} '상품 수정 전송이 완료되었습니다' 실시간 확인 · 다음 단계 진행 v${VERSION}`;
        state.version = VERSION;
        await saveStateV031(state);
        await completeJob(
          job.id,
          `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 처리 완료 · Shopling 완료문구 실시간 확인 · 마켓 성공/실패 검증 없음 v${VERSION}`,
        );
        return { ok: true, completed: true, tabId: completionTabId, href: completionHref };
      }

      job.message = sawProcessing
        ? `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 처리중 · 완료문구 대기 v${VERSION}`
        : `${job.mode === "PRICE" ? "판매가" : "옵션"} 결과창 확인 중 · 완료문구 실시간 재조회 v${VERSION}`;
      state.version = VERSION;
      await saveStateV031(state);
      return { ok: true, completed: false };
    } finally {
      reconcileBusy = false;
    }
  }

  const baseStartRunV031 = startRun;
  startRun = async function startRunV031(sourceTabId, testMode = false) {
    const result = await baseStartRunV031(sourceTabId, testMode);
    const state = await loadStateV031();
    if (state) {
      state.version = VERSION;
      await saveStateV031(state);
      return publicState(state);
    }
    return result;
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "A21_RECONCILE_V031") return false;
    reconcileCompletionV031()
      .then(async (diagnostic) => {
        const state = await loadStateV031();
        sendResponse({ ok: true, diagnostic, state: state ? publicState(state) : null });
      })
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
})();

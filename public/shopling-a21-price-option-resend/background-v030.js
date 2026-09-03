importScripts("background-v020.js");

(() => {
  const VERSION = "0.3.0";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  const SHOPLING_ORIGIN = "https://a.shopling.co.kr/";
  const POLL_MS = 500;
  const COMPLETE_GRACE_MS = 1_500;
  const WAIT_LIMIT_MS = 20 * 60 * 1000;
  const activeWatchers = new Set();

  const sleepV030 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isShoplingV030 = (url) => String(url || "").startsWith(SHOPLING_ORIGIN);

  async function loadStateV030() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function saveStateV030(state) {
    if (!state) return null;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  async function inspectCompletionTab(tabId) {
    try {
      return await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
          const text = norm(document.body?.innerText || document.body?.textContent || "");
          const completion = /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text)
            || /상품\s*수정\s*전송\s*완료/i.test(text);
          const processing = /처리중입니다/i.test(text) && /잠시만\s*기다려주시기/i.test(text);
          const resultEvidence = completion
            || /쇼핑몰\s*상품\s*수정\s*전송\s*결과/i.test(text)
            || /성공건수\s*[:：]?\s*\d+/i.test(text)
            || /실패건수\s*[:：]?\s*\d+/i.test(text);
          return { completion, processing, resultEvidence, href: location.href };
        },
      });
    } catch {
      return [];
    }
  }

  async function staleResultTabIds(sourceTabId) {
    const tabs = await chrome.tabs.query({});
    const stale = [];
    for (const tab of tabs) {
      if (!Number.isInteger(tab.id) || tab.id === sourceTabId || !isShoplingV030(tab.url)) continue;
      const rows = await inspectCompletionTab(tab.id);
      const isResult = rows.some((row) => row?.result?.completion === true || row?.result?.resultEvidence === true);
      if (isResult) stale.push(tab.id);
    }
    return stale;
  }

  async function closeStaleResultTabs(sourceTabId) {
    const ids = await staleResultTabIds(sourceTabId);
    for (const id of ids) await chrome.tabs.remove(id).catch(() => null);
  }

  function sortJobsPricesFirstV030(state) {
    if (!state?.jobs) return;
    state.jobs.sort((a, b) => {
      const modeRank = (mode) => mode === "PRICE" ? 0 : mode === "OPTION" ? 1 : 2;
      const byMode = modeRank(a.mode) - modeRank(b.mode);
      if (byMode) return byMode;
      return Number(a.batchIndex || 0) - Number(b.batchIndex || 0);
    });
  }

  monitorResult = async () => {};

  const baseStartRunV030 = startRun;
  startRun = async function startRunV030(sourceTabId, testMode = false) {
    await closeStaleResultTabs(sourceTabId);
    const result = await baseStartRunV030(sourceTabId, testMode);
    const state = await loadStateV030();
    if (!state) return result;
    state.version = VERSION;
    sortJobsPricesFirstV030(state);
    await saveStateV030(state);
    return publicState(state);
  };

  async function pumpV030() {
    const state = await loadStateV030();
    if (!state || state.state !== "RUNNING" || state.stopped) return;
    if (state.jobs.some((job) => job.status === "RUNNING")) return;

    const next = state.jobs.find((job) => job.status === "QUEUED" && job.mode === "PRICE")
      || state.jobs.find((job) => job.status === "QUEUED" && job.mode === "OPTION")
      || state.jobs.find((job) => job.status === "QUEUED");

    if (!next) return finalizeOrPump();
    try {
      await launchJob(state, next);
    } catch (error) {
      next.status = "FAILED";
      next.stage = "FAILED";
      next.error = "V030_WINDOW_CREATE";
      next.message = error instanceof Error ? error.message : String(error);
      await saveStateV030(state);
      await finalizeOrPump();
    }
  }
  pump = pumpV030;

  const baseCloseManagedV030 = closeManaged;
  closeManaged = async function closeManagedV030(job) {
    if (Number.isInteger(job?.resultTabId)
        && job.resultTabId !== job.popupTabId
        && job.resultTabId !== job.workerTabId) {
      await chrome.tabs.remove(job.resultTabId).catch(() => null);
    }
    await baseCloseManagedV030(job);
  };

  async function watchCompletionFooter(jobId) {
    if (activeWatchers.has(jobId)) return;
    activeWatchers.add(jobId);
    const startedAt = Date.now();
    let completionSince = 0;

    try {
      while (Date.now() - startedAt < WAIT_LIMIT_MS) {
        const state = await loadStateV030();
        const job = state?.jobs?.find((item) => item.id === jobId);
        if (!state || state.state !== "RUNNING" || !job || job.status !== "RUNNING") return;
        if (job.stage !== "RESULT_WAIT") {
          await sleepV030(100);
          continue;
        }

        const tabs = await chrome.tabs.query({});
        let completionTabId = null;
        let sawProcessing = false;
        let sawResultEvidence = false;

        for (const tab of tabs) {
          if (!Number.isInteger(tab.id) || !isShoplingV030(tab.url)) continue;
          const rows = await inspectCompletionTab(tab.id);
          for (const row of rows) {
            const result = row?.result;
            if (!result) continue;
            if (result.processing) sawProcessing = true;
            if (result.resultEvidence) sawResultEvidence = true;
            if (result.completion) completionTabId = tab.id;
          }
        }

        if (sawProcessing) {
          completionSince = 0;
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 처리중 · Shopling 완료문구 대기 · 마켓 성공/실패 검증 없음 v${VERSION}`;
          await saveStateV030(state);
          await sleepV030(POLL_MS);
          continue;
        }

        if (Number.isInteger(completionTabId)) {
          job.resultTabId = completionTabId;
          if (!completionSince) completionSince = Date.now();
          const stableMs = Date.now() - completionSince;
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} '상품 수정 전송이 완료되었습니다' 확인 · 안정화 ${Math.min(stableMs, COMPLETE_GRACE_MS)}/${COMPLETE_GRACE_MS}ms`;
          await saveStateV030(state);
          if (stableMs >= COMPLETE_GRACE_MS) {
            await completeJob(
              job.id,
              `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 처리 완료 · Shopling 완료문구 확인 · 마켓 성공/실패 검증 없음 v${VERSION}`,
            );
            return;
          }
        } else {
          completionSince = 0;
          job.message = sawResultEvidence
            ? `${job.mode === "PRICE" ? "판매가" : "옵션"} 결과화면 로딩 중 · Shopling 완료문구 대기 v${VERSION}`
            : `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 결과창 생성/완료문구 대기 v${VERSION}`;
          await saveStateV030(state);
        }

        await sleepV030(POLL_MS);
      }

      const state = await loadStateV030();
      const job = state?.jobs?.find((item) => item.id === jobId);
      if (state && job && job.status === "RUNNING") {
        await failJob(job.id, "V030_COMPLETION_TIMEOUT", "Shopling '상품 수정 전송이 완료되었습니다' 문구를 20분 동안 확인하지 못했습니다.");
      }
    } finally {
      activeWatchers.delete(jobId);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "A21_STAGE" && String(message.stage || "") === "RESULT_WAIT" && message.jobId) {
      setTimeout(() => void watchCompletionFooter(String(message.jobId)), 25);
      return false;
    }
    return false;
  });
})();

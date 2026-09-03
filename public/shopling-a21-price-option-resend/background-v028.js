importScripts("background-v020.js");

(() => {
  const VERSION = "0.2.8";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  const SHOPLING_ORIGIN = "https://a.shopling.co.kr/";
  const RESULT_CLEAR_GRACE_MS = 4_000;
  const RESULT_WAIT_ARM_MS = 2_500;
  const RESULT_WAIT_RETRY_MS = 25;

  const sleepV028 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isShoplingV028 = (url) => String(url || "").startsWith(SHOPLING_ORIGIN);

  async function loadStateV028() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function saveStateV028(state) {
    if (!state) return null;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  function sortJobsPricesFirst(state) {
    if (!state?.jobs) return;
    state.jobs.sort((a, b) => {
      const modeRank = (mode) => mode === "PRICE" ? 0 : mode === "OPTION" ? 1 : 2;
      const byMode = modeRank(a.mode) - modeRank(b.mode);
      if (byMode) return byMode;
      return Number(a.batchIndex || 0) - Number(b.batchIndex || 0);
    });
  }

  // 기존 base의 성공/실패 결과 판정은 완전히 비활성화한다.
  // v0.2.8은 성공 여부를 읽지 않고 Shopling의 "처리중입니다" 로딩 종료만 기다린다.
  monitorResult = async () => {};

  const baseStartRunV028 = startRun;
  startRun = async function startRunV028(sourceTabId, testMode = false) {
    const baselineTabs = await chrome.tabs.query({});
    const baselineShoplingTabIds = baselineTabs
      .filter((tab) => Number.isInteger(tab.id) && isShoplingV028(tab.url))
      .map((tab) => tab.id);

    await baseStartRunV028(sourceTabId, testMode);
    const state = await loadStateV028();
    if (!state) return publicState(state);
    state.version = VERSION;
    state.runBaselineShoplingTabIds = baselineShoplingTabIds;
    state.runBaselineCapturedAt = Date.now();
    sortJobsPricesFirst(state);
    await saveStateV028(state);
    return publicState(state);
  };

  async function pumpV028() {
    const state = await loadStateV028();
    if (!state || state.state !== "RUNNING" || state.stopped) return;
    if (state.jobs.some((job) => job.status === "RUNNING")) return;

    // 전체 PRICE 묶음을 모두 처리한 뒤 OPTION 단계로 넘어간다.
    const next = state.jobs.find((job) => job.status === "QUEUED" && job.mode === "PRICE")
      || state.jobs.find((job) => job.status === "QUEUED" && job.mode === "OPTION")
      || state.jobs.find((job) => job.status === "QUEUED");

    if (!next) return finalizeOrPump();
    try {
      await launchJob(state, next);
    } catch (error) {
      next.status = "FAILED";
      next.stage = "FAILED";
      next.error = "V028_WINDOW_CREATE";
      next.message = error instanceof Error ? error.message : String(error);
      await saveStateV028(state);
      await finalizeOrPump();
    }
  }
  pump = pumpV028;

  const baseCloseManagedV028 = closeManaged;
  closeManaged = async function closeManagedV028(job) {
    if (Number.isInteger(job?.resultTabId)
        && job.resultTabId !== job.popupTabId
        && job.resultTabId !== job.workerTabId) {
      await chrome.tabs.remove(job.resultTabId).catch(() => null);
    }
    await baseCloseManagedV028(job);
  };

  async function armLoadingWait(jobId) {
    const deadline = Date.now() + RESULT_WAIT_ARM_MS;
    while (Date.now() < deadline) {
      const state = await loadStateV028();
      const job = state?.jobs?.find((item) => item.id === jobId);
      if (!state || !job || job.status !== "RUNNING") return;
      if (job.stage === "RESULT_WAIT") {
        job.loadingWaitArmed = true;
        job.loadingWaitStartedAt = Date.now();
        job.sawShoplingProcessing = false;
        job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 처리중 · Shopling 로딩 종료 대기 · 결과 성공/실패 검증 없음`;
        await saveStateV028(state);
        return;
      }
      await sleepV028(RESULT_WAIT_RETRY_MS);
    }
  }

  function senderBelongsToJob(sender, state, job) {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) return false;
    if ([job.popupTabId, job.workerTabId, job.resultTabId].filter(Number.isInteger).includes(tabId)) return true;
    if ([job.popupTabId, job.workerTabId].filter(Number.isInteger).includes(sender?.tab?.openerTabId)) return true;
    const baseline = new Set(Array.isArray(state.runBaselineShoplingTabIds) ? state.runBaselineShoplingTabIds : []);
    return isShoplingV028(sender?.tab?.url) && !baseline.has(tabId);
  }

  async function handleLoadingState(message, sender) {
    const state = await loadStateV028();
    const job = state?.jobs?.find((item) => item.status === "RUNNING" && item.stage === "RESULT_WAIT");
    if (!state || state.state !== "RUNNING" || !job || !senderBelongsToJob(sender, state, job)) return;

    const tabId = sender?.tab?.id;
    const processing = message.processing === true;
    const resultEvidence = message.resultEvidence === true;
    const clearForMs = Number(message.clearForMs || 0);

    if (Number.isInteger(tabId) && (processing || resultEvidence)) job.resultTabId = tabId;

    if (processing) {
      job.sawShoplingProcessing = true;
      job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 처리중 · Shopling '처리중입니다' 로딩 완료 대기`;
      await saveStateV028(state);
      return;
    }

    if (!resultEvidence) return;
    if (!job.sawShoplingProcessing && clearForMs < RESULT_CLEAR_GRACE_MS) return;

    job.loadingFinishedAt = Date.now();
    await saveStateV028(state);
    await completeJob(
      job.id,
      `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 처리 완료 · Shopling 로딩 종료 확인 · 마켓 성공/실패 검증 없음 v${VERSION}`,
    );
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === "A21_STAGE" && String(message.stage || "") === "RESULT_WAIT" && message.jobId) {
      setTimeout(() => void armLoadingWait(String(message.jobId)), 10);
      return false;
    }
    if (message?.type === "A21_RESULT_LOADING_V028") {
      void handleLoadingState(message, sender);
      return false;
    }
    return false;
  });
})();

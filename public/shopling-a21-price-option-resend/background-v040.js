importScripts("background-v020.js");

(() => {
  const VERSION = "0.4.0";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  const STABLE_MS = 1_800;
  const FRAME_FRESH_MS = 2_500;
  const WAIT_LIMIT_MS = 30 * 60 * 1000;
  const tabActivityAt = new Map();

  const sleepV040 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loadStateV040() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function saveStateV040(state) {
    if (!state) return null;
    state.version = VERSION;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  function sortJobsPricesFirstV040(state) {
    if (!state?.jobs) return;
    state.jobs.sort((a, b) => {
      const rank = (mode) => mode === "PRICE" ? 0 : mode === "OPTION" ? 1 : 2;
      const byMode = rank(a.mode) - rank(b.mode);
      if (byMode) return byMode;
      return Number(a.batchIndex || 0) - Number(b.batchIndex || 0);
    });
  }

  monitorResult = async () => {};

  const baseStartRunV040 = startRun;
  startRun = async function startRunV040(sourceTabId, testMode = false) {
    const result = await baseStartRunV040(sourceTabId, testMode);
    const state = await loadStateV040();
    if (!state) return result;
    state.version = VERSION;
    state.resultPolicy = "SELF_REPORTING_RESULT_DOCUMENT";
    sortJobsPricesFirstV040(state);
    await saveStateV040(state);
    return publicState(state);
  };

  async function pumpV040() {
    const state = await loadStateV040();
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
      next.error = "V040_WINDOW_CREATE";
      next.message = error instanceof Error ? error.message : String(error);
      await saveStateV040(state);
      await finalizeOrPump();
    }
  }
  pump = pumpV040;

  const baseCloseManagedV040 = closeManaged;
  closeManaged = async function closeManagedV040(job) {
    const resultWindowId = Number.isInteger(job?.resultWindowId) ? job.resultWindowId : null;
    await baseCloseManagedV040(job);
    if (Number.isInteger(resultWindowId)
        && resultWindowId !== job?.popupWindowId
        && resultWindowId !== job?.workerWindowId) {
      await chrome.windows.remove(resultWindowId).catch(() => null);
    }
  };

  chrome.tabs.onCreated.addListener((tab) => {
    if (Number.isInteger(tab?.id)) tabActivityAt.set(tab.id, Date.now());
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo?.status === "loading" || changeInfo?.url) tabActivityAt.set(tabId, Date.now());
  });
  chrome.tabs.onRemoved.addListener((tabId) => tabActivityAt.delete(tabId));
  if (chrome.webNavigation?.onCommitted) {
    chrome.webNavigation.onCommitted.addListener((details) => {
      if (Number.isInteger(details?.tabId) && details.tabId >= 0) tabActivityAt.set(details.tabId, Date.now());
    });
  }

  async function senderRelatedToJob(job, senderTab) {
    if (!job || !senderTab || !Number.isInteger(senderTab.id)) return false;
    const roots = new Set([job.workerTabId, job.popupTabId].filter((value) => Number.isInteger(value)));
    if (roots.has(senderTab.id)) return true;

    let cursor = senderTab;
    for (let depth = 0; depth < 4; depth += 1) {
      const opener = cursor?.openerTabId;
      if (!Number.isInteger(opener)) break;
      if (roots.has(opener)) return true;
      cursor = await chrome.tabs.get(opener).catch(() => null);
      if (!cursor) break;
    }

    if (Number.isInteger(job.popupWindowId) && senderTab.windowId === job.popupWindowId) return true;

    const submitAt = Number(job.submitAckAt || job.resultWatchStartedAt || job.updatedAt || 0);
    const activityAt = Number(tabActivityAt.get(senderTab.id) || 0);
    return activityAt > 0 && submitAt > 0 && activityAt >= submitAt - 5_000;
  }

  function recentFrameRows(job, now = Date.now()) {
    const frames = job?.resultFrames && typeof job.resultFrames === "object" ? job.resultFrames : {};
    return Object.values(frames).filter((row) => row && now - Number(row.at || 0) <= FRAME_FRESH_MS);
  }

  async function evaluateResultJob(jobId) {
    if (!jobId) return;
    const state = await loadStateV040();
    const job = state?.jobs?.find((item) => item.id === jobId);
    if (!state || state.state !== "RUNNING" || state.stopped || !job || job.status !== "RUNNING") return;
    if (!["SUBMIT_CLICKED", "RESULT_WAIT"].includes(String(job.stage || ""))) return;

    const now = Date.now();
    if (!job.resultWatchStartedAt) job.resultWatchStartedAt = now;
    if (now - Number(job.resultWatchStartedAt || now) > WAIT_LIMIT_MS) {
      await failJob(job.id, "V040_RESULT_DOCUMENT_TIMEOUT", "Shopling 실제 결과문서의 로딩 종료 신호를 30분 동안 확인하지 못했습니다.");
      return;
    }

    const rows = recentFrameRows(job, now);
    const anyProcessing = rows.some((row) => row.processing === true);
    const anyEvidence = rows.some((row) => row.evidence === true);
    const anyFooter = rows.some((row) => row.footer === true || row.strongEvidence === true);

    if (anyProcessing) {
      job.resultSawProcessing = true;
      job.resultClearSince = 0;
      job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 실제 결과문서에서 '처리중입니다' 확인 · 로딩 종료까지 창 유지 v${VERSION}`;
      await saveStateV040(state);
      return;
    }

    const completionEvidence = anyEvidence && (job.resultSawProcessing === true || anyFooter);
    if (!completionEvidence) {
      job.resultClearSince = 0;
      job.message = rows.length
        ? `${job.mode === "PRICE" ? "판매가" : "옵션"} 실제 결과문서 연결됨 · 처리중 표시 또는 완료 footer 확인 대기 v${VERSION}`
        : `${job.mode === "PRICE" ? "판매가" : "옵션"} 실제 결과문서 self-observer 신호 대기 · 조기 완료 금지 v${VERSION}`;
      await saveStateV040(state);
      return;
    }

    if (!job.resultClearSince) job.resultClearSince = now;
    const stableMs = now - Number(job.resultClearSince || now);
    job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 실제 결과문서 로딩 종료 확인 · 안정화 ${Math.min(stableMs, STABLE_MS)}/${STABLE_MS}ms v${VERSION}`;
    await saveStateV040(state);

    if (stableMs >= STABLE_MS && String(job.stage || "") === "RESULT_WAIT") {
      await completeJob(
        job.id,
        `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 완료 · 실제 결과문서 로딩 종료/self-observer 확인 · 마켓별 결과 검증 없음 v${VERSION}`,
      );
    }
  }

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === "A21_RESULT_STATUS_V040") {
      void (async () => {
        const state = await loadStateV040();
        const running = state?.jobs?.find((job) => job.status === "RUNNING" && ["SUBMIT_CLICKED", "RESULT_WAIT"].includes(String(job.stage || "")));
        if (!state || state.state !== "RUNNING" || state.stopped || !running || !sender?.tab) return;
        if (!(await senderRelatedToJob(running, sender.tab))) return;

        const snap = message.snapshot || {};
        const frameKey = `${sender.tab.id}:${Number.isInteger(sender.frameId) ? sender.frameId : 0}`;
        running.resultTabId = sender.tab.id;
        running.resultWindowId = sender.tab.windowId;
        running.resultFrames = running.resultFrames && typeof running.resultFrames === "object" ? running.resultFrames : {};
        running.resultFrames[frameKey] = {
          at: Date.now(),
          processing: Boolean(snap.processing),
          evidence: Boolean(snap.evidence),
          strongEvidence: Boolean(snap.strongEvidence),
          footer: Boolean(snap.footer),
          resultHeading: Boolean(snap.resultHeading),
          successCountLabels: Number(snap.successCountLabels || 0),
          failCountLabels: Number(snap.failCountLabels || 0),
          outcomeRows: Boolean(snap.outcomeRows),
          href: String(snap.href || "").slice(0, 500),
          title: String(snap.title || "").slice(0, 200),
        };
        if (snap.processing) running.resultSawProcessing = true;
        await saveStateV040(state);
        await evaluateResultJob(running.id);
      })();
      return false;
    }

    if (message?.type === "A21_STAGE" && message.jobId && String(message.stage || "") === "RESULT_WAIT") {
      setTimeout(() => void evaluateResultJob(String(message.jobId)), 180);
      return false;
    }

    if (message?.type === "A21_GET_STATE") {
      setTimeout(async () => {
        const state = await loadStateV040();
        const running = state?.jobs?.find((job) => job.status === "RUNNING" && ["SUBMIT_CLICKED", "RESULT_WAIT"].includes(String(job.stage || "")));
        if (running) void evaluateResultJob(running.id);
      }, 0);
      return false;
    }

    return false;
  });
})();

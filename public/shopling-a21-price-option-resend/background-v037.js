importScripts("background-v020.js");

(() => {
  const VERSION = "0.3.7";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  const SHOPLING_FILTER = { urls: ["https://a.shopling.co.kr/*"] };
  const TRACKED_TYPES = new Set(["main_frame", "sub_frame", "xmlhttprequest", "other"]);
  const POLL_MS = 400;
  const QUIET_MS = 2_500;
  const MIN_WAIT_MS = 3_000;
  const WAIT_LIMIT_MS = 30 * 60 * 1000;
  const PREWATCH_GRACE_MS = 5_000;
  const activeRequests = new Map();
  const recentEvents = [];
  const activeWatchers = new Set();

  const sleepV037 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loadStateV037() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function saveStateV037(state) {
    if (!state) return null;
    state.version = VERSION;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  function pushEvent(details, phase) {
    if (!TRACKED_TYPES.has(String(details?.type || ""))) return;
    const event = {
      requestId: String(details?.requestId || ""),
      tabId: Number.isInteger(details?.tabId) ? details.tabId : -1,
      type: String(details?.type || ""),
      url: String(details?.url || ""),
      initiator: String(details?.initiator || details?.originUrl || ""),
      phase,
      at: Date.now(),
    };
    recentEvents.push(event);
    if (recentEvents.length > 300) recentEvents.splice(0, recentEvents.length - 300);
  }

  chrome.webRequest.onBeforeRequest.addListener((details) => {
    if (!TRACKED_TYPES.has(String(details?.type || ""))) return;
    activeRequests.set(String(details.requestId), {
      requestId: String(details.requestId),
      tabId: Number.isInteger(details.tabId) ? details.tabId : -1,
      type: String(details.type || ""),
      url: String(details.url || ""),
      initiator: String(details.initiator || details.originUrl || ""),
      startedAt: Date.now(),
    });
    pushEvent(details, "start");
  }, SHOPLING_FILTER);

  function finishRequest(details, phase) {
    activeRequests.delete(String(details?.requestId || ""));
    pushEvent(details, phase);
  }

  chrome.webRequest.onCompleted.addListener((details) => finishRequest(details, "completed"), SHOPLING_FILTER);
  chrome.webRequest.onErrorOccurred.addListener((details) => finishRequest(details, "error"), SHOPLING_FILTER);

  function sortJobsPricesFirstV037(state) {
    if (!state?.jobs) return;
    state.jobs.sort((a, b) => {
      const rank = (mode) => mode === "PRICE" ? 0 : mode === "OPTION" ? 1 : 2;
      const byMode = rank(a.mode) - rank(b.mode);
      if (byMode) return byMode;
      return Number(a.batchIndex || 0) - Number(b.batchIndex || 0);
    });
  }

  monitorResult = async () => {};

  const baseStartRunV037 = startRun;
  startRun = async function startRunV037(sourceTabId, testMode = false) {
    const result = await baseStartRunV037(sourceTabId, testMode);
    const state = await loadStateV037();
    if (!state) return result;
    state.version = VERSION;
    state.resultPolicy = "SHOPLING_NETWORK_IDLE";
    sortJobsPricesFirstV037(state);
    await saveStateV037(state);
    return publicState(state);
  };

  async function pumpV037() {
    const state = await loadStateV037();
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
      next.error = "V037_WINDOW_CREATE";
      next.message = error instanceof Error ? error.message : String(error);
      await saveStateV037(state);
      await finalizeOrPump();
    }
  }
  pump = pumpV037;

  async function relatedTabIds(job) {
    const ids = new Set();
    for (const value of [job?.workerTabId, job?.popupTabId, job?.resultTabId]) {
      if (Number.isInteger(value) && value >= 0) ids.add(value);
    }
    const tabs = await chrome.tabs.query({});
    let changed = true;
    while (changed) {
      changed = false;
      for (const tab of tabs) {
        if (!Number.isInteger(tab.id)) continue;
        if (Number.isInteger(tab.openerTabId) && ids.has(tab.openerTabId) && !ids.has(tab.id)) {
          ids.add(tab.id);
          changed = true;
        }
      }
    }
    return ids;
  }

  function isShoplingInitiated(row) {
    return String(row?.url || "").startsWith("https://a.shopling.co.kr/")
      || String(row?.initiator || "").startsWith("https://a.shopling.co.kr/");
  }

  async function networkSnapshot(job, watchStartedAt) {
    const ids = await relatedTabIds(job);
    const cutoff = watchStartedAt - PREWATCH_GRACE_MS;
    const relevantActive = [...activeRequests.values()].filter((row) => {
      if (!isShoplingInitiated(row)) return false;
      return row.startedAt >= cutoff && (ids.has(row.tabId) || row.tabId < 0 || String(row.initiator || "").startsWith("https://a.shopling.co.kr/"));
    });
    const relevantRecent = recentEvents.filter((row) => {
      if (row.at < cutoff || !isShoplingInitiated(row)) return false;
      return ids.has(row.tabId) || row.tabId < 0 || String(row.initiator || "").startsWith("https://a.shopling.co.kr/");
    });
    const lastActivityAt = Math.max(
      0,
      ...relevantActive.map((row) => Number(row.startedAt || 0)),
      ...relevantRecent.map((row) => Number(row.at || 0)),
    );
    const resultTabCandidates = relevantRecent
      .filter((row) => Number.isInteger(row.tabId) && row.tabId >= 0 && row.tabId !== job.workerTabId && row.tabId !== job.popupTabId && row.type === "main_frame")
      .sort((a, b) => b.at - a.at);
    return {
      ids,
      activeCount: relevantActive.length,
      eventCount: relevantRecent.length,
      sawNetwork: relevantRecent.length > 0 || relevantActive.length > 0,
      lastActivityAt,
      resultTabId: resultTabCandidates[0]?.tabId ?? null,
      activeTypes: [...new Set(relevantActive.map((row) => row.type))],
    };
  }

  async function watchNetworkIdle(jobId) {
    if (!jobId || activeWatchers.has(jobId)) return;
    activeWatchers.add(jobId);
    const watchStartedAt = Date.now();
    let quietSince = 0;

    try {
      while (Date.now() - watchStartedAt < WAIT_LIMIT_MS) {
        const state = await loadStateV037();
        const job = state?.jobs?.find((item) => item.id === jobId);
        if (!state || state.state !== "RUNNING" || !job || job.status !== "RUNNING" || state.stopped) return;
        if (String(job.stage || "") !== "RESULT_WAIT") {
          await sleepV037(100);
          continue;
        }

        const snap = await networkSnapshot(job, watchStartedAt);
        const elapsed = Date.now() - watchStartedAt;
        if (Number.isInteger(snap.resultTabId)) job.resultTabId = snap.resultTabId;

        if (!snap.sawNetwork) {
          quietSince = 0;
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 송신 ACK 완료 · 브라우저 네트워크 시작 대기 v${VERSION}`;
          await saveStateV037(state);
          await sleepV037(POLL_MS);
          continue;
        }

        if (snap.activeCount > 0) {
          quietSince = 0;
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 전송 처리중 · 활성 요청 ${snap.activeCount}개${snap.activeTypes.length ? ` (${snap.activeTypes.join(",")})` : ""} · 네트워크 종료 대기 v${VERSION}`;
          await saveStateV037(state);
          await sleepV037(POLL_MS);
          continue;
        }

        const lastActivityAt = snap.lastActivityAt || Date.now();
        const networkQuietMs = Date.now() - lastActivityAt;
        if (!quietSince) quietSince = Date.now();
        const stableQuietMs = Date.now() - quietSince;
        job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 네트워크 종료 감지 · 무통신 ${Math.min(networkQuietMs, QUIET_MS)}/${QUIET_MS}ms · 안정화 ${Math.min(stableQuietMs, QUIET_MS)}/${QUIET_MS}ms v${VERSION}`;
        await saveStateV037(state);

        if (elapsed >= MIN_WAIT_MS && networkQuietMs >= QUIET_MS && stableQuietMs >= QUIET_MS) {
          await completeJob(
            job.id,
            `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 완료 · Shopling 브라우저 네트워크 요청 종료/무통신 확인 · 결과 내용 검증 없음 v${VERSION}`,
          );
          return;
        }

        await sleepV037(POLL_MS);
      }

      const state = await loadStateV037();
      const job = state?.jobs?.find((item) => item.id === jobId);
      if (state && job && job.status === "RUNNING") {
        await failJob(job.id, "V037_NETWORK_IDLE_TIMEOUT", "Shopling 수정전송의 브라우저 네트워크 종료를 30분 동안 확인하지 못했습니다.");
      }
    } finally {
      activeWatchers.delete(jobId);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "A21_STAGE"
        && String(message.stage || "") === "RESULT_WAIT"
        && message.jobId) {
      setTimeout(() => void watchNetworkIdle(String(message.jobId)), 10);
    }
    return false;
  });
})();

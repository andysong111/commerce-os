importScripts("background-v020.js");

(() => {
  const VERSION = "0.3.8";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  const SHOPLING_FILTER = { urls: ["https://a.shopling.co.kr/*"] };
  const TRACKED_TYPES = new Set(["main_frame", "sub_frame", "xmlhttprequest", "other"]);
  const POLL_MS = 400;
  const STABLE_MS = 1_800;
  const WAIT_LIMIT_MS = 30 * 60 * 1000;
  const PREWATCH_GRACE_MS = 8_000;
  const recentEvents = [];
  const activeWatchers = new Set();

  const sleepV038 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loadStateV038() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function saveStateV038(state) {
    if (!state) return null;
    state.version = VERSION;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  function pushEvent(details, phase) {
    if (!TRACKED_TYPES.has(String(details?.type || ""))) return;
    recentEvents.push({
      requestId: String(details?.requestId || ""),
      tabId: Number.isInteger(details?.tabId) ? details.tabId : -1,
      type: String(details?.type || ""),
      url: String(details?.url || ""),
      initiator: String(details?.initiator || details?.originUrl || ""),
      phase,
      at: Date.now(),
    });
    if (recentEvents.length > 500) recentEvents.splice(0, recentEvents.length - 500);
  }

  chrome.webRequest.onBeforeRequest.addListener((details) => pushEvent(details, "start"), SHOPLING_FILTER);
  chrome.webRequest.onCompleted.addListener((details) => pushEvent(details, "completed"), SHOPLING_FILTER);
  chrome.webRequest.onErrorOccurred.addListener((details) => pushEvent(details, "error"), SHOPLING_FILTER);

  function sortJobsPricesFirstV038(state) {
    if (!state?.jobs) return;
    state.jobs.sort((a, b) => {
      const rank = (mode) => mode === "PRICE" ? 0 : mode === "OPTION" ? 1 : 2;
      const byMode = rank(a.mode) - rank(b.mode);
      if (byMode) return byMode;
      return Number(a.batchIndex || 0) - Number(b.batchIndex || 0);
    });
  }

  monitorResult = async () => {};

  const baseStartRunV038 = startRun;
  startRun = async function startRunV038(sourceTabId, testMode = false) {
    const result = await baseStartRunV038(sourceTabId, testMode);
    const state = await loadStateV038();
    if (!state) return result;
    state.version = VERSION;
    state.resultPolicy = "EXACT_RESULT_VISIBLE_LOADING_END";
    sortJobsPricesFirstV038(state);
    await saveStateV038(state);
    return publicState(state);
  };

  async function pumpV038() {
    const state = await loadStateV038();
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
      next.error = "V038_WINDOW_CREATE";
      next.message = error instanceof Error ? error.message : String(error);
      await saveStateV038(state);
      await finalizeOrPump();
    }
  }
  pump = pumpV038;

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

  async function candidateResultTabIds(job, watchStartedAt) {
    const ids = await relatedTabIds(job);
    const cutoff = watchStartedAt - PREWATCH_GRACE_MS;
    const candidates = recentEvents
      .filter((row) => row.at >= cutoff
        && row.type === "main_frame"
        && Number.isInteger(row.tabId)
        && row.tabId >= 0
        && (ids.has(row.tabId) || String(row.initiator || "").startsWith("https://a.shopling.co.kr/")))
      .sort((a, b) => b.at - a.at)
      .map((row) => row.tabId);

    for (const value of [job?.resultTabId, job?.popupTabId, job?.workerTabId]) {
      if (Number.isInteger(value) && value >= 0) candidates.push(value);
    }
    return [...new Set(candidates)];
  }

  async function probeResultTab(tabId) {
    try {
      const rows = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
          const text = norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || "");
          const processing = /처리중입니다/i.test(text) || /잠시만\s*기다려주시기\s*바랍니다/i.test(text);
          const resultEvidence = /쇼핑몰\s*상품\s*수정\s*전송\s*결과/i.test(text)
            || /상품\s*수정\s*전송\s*결과/i.test(text)
            || /성공건수\s*[:：]?\s*\d+/i.test(text)
            || /실패건수\s*[:：]?\s*\d+/i.test(text)
            || /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text);
          return {
            processing,
            resultEvidence,
            readyState: document.readyState,
            href: String(location.href || ""),
            title: String(document.title || ""),
            textLength: text.length,
          };
        },
      });
      return rows.map((row) => row?.result).filter(Boolean);
    } catch (error) {
      return [{ accessError: error instanceof Error ? error.message : String(error) }];
    }
  }

  async function inspectCandidates(job, watchStartedAt) {
    const tabIds = await candidateResultTabIds(job, watchStartedAt);
    let accessError = "";
    for (const tabId of tabIds) {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) continue;
      const frames = await probeResultTab(tabId);
      const readable = frames.filter((row) => row && !row.accessError);
      if (!readable.length) {
        const firstError = frames.find((row) => row?.accessError)?.accessError;
        if (firstError) accessError = firstError;
        continue;
      }
      const evidence = readable.some((row) => row.resultEvidence);
      const processing = readable.some((row) => row.processing);
      if (evidence || processing) return { tabId, evidence, processing, readable, accessError: "" };
    }
    return { tabId: null, evidence: false, processing: false, readable: [], accessError };
  }

  async function watchExactResultLoading(jobId) {
    if (!jobId || activeWatchers.has(jobId)) return;
    activeWatchers.add(jobId);
    const watchStartedAt = Date.now();
    let sawProcessing = false;
    let clearSince = 0;

    try {
      while (Date.now() - watchStartedAt < WAIT_LIMIT_MS) {
        const state = await loadStateV038();
        const job = state?.jobs?.find((item) => item.id === jobId);
        if (!state || state.state !== "RUNNING" || !job || job.status !== "RUNNING" || state.stopped) return;
        if (String(job.stage || "") !== "RESULT_WAIT") {
          await sleepV038(100);
          continue;
        }

        const probe = await inspectCandidates(job, watchStartedAt);
        if (Number.isInteger(probe.tabId)) job.resultTabId = probe.tabId;

        if (!Number.isInteger(probe.tabId)) {
          clearSince = 0;
          job.message = probe.accessError
            ? `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 결과창은 감지했지만 DOM 접근 불가 · 조기 완료 금지 v${VERSION}`
            : `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 실제 결과창/로딩 화면 연결 대기 · 조기 완료 금지 v${VERSION}`;
          await saveStateV038(state);
          await sleepV038(POLL_MS);
          continue;
        }

        if (probe.processing) {
          sawProcessing = true;
          clearSince = 0;
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 실제 결과창 로딩 중 확인 · '처리중입니다' 종료까지 창 유지 v${VERSION}`;
          await saveStateV038(state);
          await sleepV038(POLL_MS);
          continue;
        }

        if (!probe.evidence) {
          clearSince = 0;
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 결과창 직접 연결됨 · 결과표/로딩 표시 생성 대기 v${VERSION}`;
          await saveStateV038(state);
          await sleepV038(POLL_MS);
          continue;
        }

        if (!sawProcessing) {
          clearSince = 0;
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 결과표 확인 · 실제 '처리중입니다' 표시를 아직 관찰하지 못해 완료 보류 v${VERSION}`;
          await saveStateV038(state);
          await sleepV038(POLL_MS);
          continue;
        }

        if (!clearSince) clearSince = Date.now();
        const stableMs = Date.now() - clearSince;
        job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 실제 로딩 종료 감지 · 안정화 ${Math.min(stableMs, STABLE_MS)}/${STABLE_MS}ms · 창 유지 v${VERSION}`;
        await saveStateV038(state);

        if (stableMs >= STABLE_MS) {
          await completeJob(
            job.id,
            `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 완료 · 실제 결과창에서 '처리중입니다' 표시 종료 확인 · 결과 내용 검증 없음 v${VERSION}`,
          );
          return;
        }

        await sleepV038(POLL_MS);
      }

      const state = await loadStateV038();
      const job = state?.jobs?.find((item) => item.id === jobId);
      if (state && job && job.status === "RUNNING") {
        await failJob(job.id, "V038_VISIBLE_LOADING_TIMEOUT", "Shopling 실제 결과창의 로딩 종료를 30분 동안 확인하지 못했습니다.");
      }
    } finally {
      activeWatchers.delete(jobId);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "A21_STAGE"
        && String(message.stage || "") === "RESULT_WAIT"
        && message.jobId) {
      setTimeout(() => void watchExactResultLoading(String(message.jobId)), 10);
    }
    if (message?.type === "A21_GET_STATE") {
      setTimeout(async () => {
        const state = await loadStateV038();
        const running = state?.jobs?.find((job) => job.status === "RUNNING" && String(job.stage || "") === "RESULT_WAIT");
        if (running) void watchExactResultLoading(running.id);
      }, 0);
    }
    return false;
  });
})();

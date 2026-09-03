importScripts("background-v020.js");

(() => {
  const TRACKER_VERSION = "0.2.4";
  const STATE_KEY_V024 = "commerceOsShoplingA21PriceOptionResendV020";
  const RESULT_WAIT_MS_V024 = 180_000;
  const RETRY_MS_V024 = 350;
  const SHOPLING_ORIGIN_V024 = "https://a.shopling.co.kr/";

  const sleepV024 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isShoplingV024 = (url) => String(url || "").startsWith(SHOPLING_ORIGIN_V024);

  async function loadStateV024() {
    const stored = await chrome.storage.local.get(STATE_KEY_V024);
    return stored[STATE_KEY_V024] || null;
  }

  async function saveStateV024(state) {
    if (!state) return null;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY_V024]: state });
    return state;
  }

  function relatedToJob(job, tab) {
    if (!job || !tab || !Number.isInteger(tab.id) || !isShoplingV024(tab.url)) return false;
    const tracked = new Set([
      job.popupTabId,
      job.workerTabId,
      ...(Array.isArray(job.resultTabIds) ? job.resultTabIds : []),
    ].filter(Number.isInteger));
    if (tracked.has(tab.id)) return true;
    if (Number.isInteger(tab.openerTabId) && tracked.has(tab.openerTabId)) return true;
    return false;
  }

  async function noteResultTab(jobId, tabId, reason = "result-navigation") {
    if (!Number.isInteger(tabId)) return;
    const state = await loadStateV024();
    const job = state?.jobs?.find((item) => item.id === jobId);
    if (!state || !job || job.status !== "RUNNING" || !["SUBMIT_CLICKED", "RESULT_WAIT"].includes(job.stage)) return;
    const list = new Set(Array.isArray(job.resultTabIds) ? job.resultTabIds.filter(Number.isInteger) : []);
    list.add(tabId);
    job.resultTabIds = [...list];
    job.resultTrackingStartedAt ||= Date.now();
    job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 결과 추적 중 · ${reason}`;
    await saveStateV024(state);
    setTimeout(() => void monitorResult(job.id), 120);
  }

  async function inspectTrackedTab(tabId) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !isShoplingV024(tab.url)) return [];
    return inspectResult(tabId);
  }

  async function resultCandidates(job) {
    const ids = [];
    if (Number.isInteger(job.popupTabId)) ids.push(job.popupTabId);
    for (const id of Array.isArray(job.resultTabIds) ? job.resultTabIds : []) {
      if (Number.isInteger(id)) ids.push(id);
    }
    const unique = [...new Set(ids)];
    const tabs = await Promise.all(unique.map((id) => chrome.tabs.get(id).catch(() => null)));
    return tabs.filter((tab) => tab && isShoplingV024(tab.url));
  }

  async function monitorResultV024(jobId) {
    const deadline = Date.now() + RESULT_WAIT_MS_V024;
    while (Date.now() < deadline) {
      const state = await loadStateV024();
      const job = state?.jobs?.find((item) => item.id === jobId);
      if (!state || !job || job.status !== "RUNNING") return;
      if (!["SUBMIT_CLICKED", "RESULT_WAIT"].includes(job.stage)) return;

      const candidates = await resultCandidates(job);
      for (const tab of candidates) {
        const results = await inspectTrackedTab(tab.id);
        const failed = results.find((row) => row.failed);
        if (failed) {
          await failJob(job.id, "V024_RESULT_FAILURE", `Shopling 수정전송 실패 ${failed.failure || 1}건`);
          return;
        }
        const succeeded = results.find((row) => row.succeeded);
        if (succeeded) {
          await completeJob(
            job.id,
            `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 성공 확인${succeeded.success ? ` · ${succeeded.success}건` : ""} · 결과창 추적 v0.2.4`,
          );
          return;
        }
      }
      await sleepV024(RETRY_MS_V024);
    }

    const finalState = await loadStateV024();
    const finalJob = finalState?.jobs?.find((item) => item.id === jobId);
    if (!finalJob || finalJob.status !== "RUNNING") return;
    await failJob(
      jobId,
      "V024_RESULT_TIMEOUT",
      "상품수정 송신은 호출됐지만 Shopling 성공/실패 결과 화면을 180초 동안 독립 확인하지 못했습니다. 송신창이 닫혀도 즉시 실패시키지 않고 관련 결과창/이동탭까지 추적했습니다.",
    );
  }

  // background-v020.js가 등록한 기존 콜백도 이후 호출 시 이 바인딩을 사용하도록 교체한다.
  monitorResult = monitorResultV024;

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "A21_STAGE" || String(message.stage || "") !== "SUBMIT_CLICKED" || !message.jobId) return false;
    setTimeout(() => {
      void (async () => {
        const state = await loadStateV024();
        const job = state?.jobs?.find((item) => item.id === String(message.jobId));
        if (!state || !job || job.status !== "RUNNING") return;
        job.resultTabIds = [];
        job.resultTrackingStartedAt = Date.now();
        job.resultTrackerVersion = TRACKER_VERSION;
        await saveStateV024(state);
        setTimeout(() => void monitorResult(job.id), 180);
      })();
    }, 40);
    return false;
  });

  if (chrome.webNavigation?.onCreatedNavigationTarget) {
    chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
      void (async () => {
        const state = await loadStateV024();
        if (!state || state.state !== "RUNNING") return;
        const job = state.jobs.find((item) => {
          if (item.status !== "RUNNING" || !["SUBMIT_CLICKED", "RESULT_WAIT"].includes(item.stage)) return false;
          const tracked = new Set([
            item.popupTabId,
            item.workerTabId,
            ...(Array.isArray(item.resultTabIds) ? item.resultTabIds : []),
          ].filter(Number.isInteger));
          return tracked.has(details.sourceTabId);
        });
        if (!job) return;
        await noteResultTab(job.id, details.tabId, "새 결과창 생성 감지");
      })();
    });
  }

  if (chrome.webNavigation?.onCommitted) {
    chrome.webNavigation.onCommitted.addListener((details) => {
      if (details.frameId !== 0) return;
      void (async () => {
        const tab = await chrome.tabs.get(details.tabId).catch(() => null);
        if (!tab || !isShoplingV024(tab.url)) return;
        const state = await loadStateV024();
        if (!state || state.state !== "RUNNING") return;
        const job = state.jobs.find((item) =>
          item.status === "RUNNING"
          && ["SUBMIT_CLICKED", "RESULT_WAIT"].includes(item.stage)
          && relatedToJob(item, tab),
        );
        if (!job) return;
        await noteResultTab(job.id, details.tabId, "관련 Shopling 탭 이동 감지");
      })();
    });
  }

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" || !isShoplingV024(tab?.url)) return;
    void (async () => {
      const state = await loadStateV024();
      if (!state || state.state !== "RUNNING") return;
      const job = state.jobs.find((item) =>
        item.status === "RUNNING"
        && ["SUBMIT_CLICKED", "RESULT_WAIT"].includes(item.stage)
        && relatedToJob(item, { ...tab, id: tabId }),
      );
      if (!job) return;
      await noteResultTab(job.id, tabId, "관련 Shopling 탭 로드 완료");
    })();
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const state = await loadStateV024();
      if (!state || state.state !== "RUNNING") return;
      const job = state.jobs.find((item) =>
        item.status === "RUNNING"
        && ["SUBMIT_CLICKED", "RESULT_WAIT"].includes(item.stage)
        && (item.popupTabId === tabId || (Array.isArray(item.resultTabIds) && item.resultTabIds.includes(tabId))),
      );
      if (!job) return;

      if (job.popupTabId === tabId) job.popupTabId = null;
      if (Array.isArray(job.resultTabIds)) job.resultTabIds = job.resultTabIds.filter((id) => id !== tabId);
      job.stage = "RESULT_WAIT";
      job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 송신창 닫힘 감지 · 실패 처리하지 않고 결과 이동 경로 추적 중`;
      await saveStateV024(state);
      setTimeout(() => void monitorResult(job.id), 80);
    })();
  });
})();
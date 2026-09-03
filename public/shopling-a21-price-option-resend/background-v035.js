importScripts("background-v030.js");

(() => {
  const VERSION = "0.3.5";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  const POLL_MS = 500;
  const STABLE_MS = 1_800;
  const WAIT_LIMIT_MS = 20 * 60 * 1000;
  const activeWatchers = new Set();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

  async function closeStaleShoplingPopupWindows(sourceTabId) {
    const sourceTab = Number.isInteger(sourceTabId) ? await chrome.tabs.get(sourceTabId).catch(() => null) : null;
    const sourceWindowId = sourceTab?.windowId;
    const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["popup"] }).catch(() => []);
    for (const win of windows) {
      if (!Number.isInteger(win?.id) || win.id === sourceWindowId) continue;
      const shoplingish = (win.tabs || []).some((tab) => {
        const url = String(tab?.url || "");
        const title = String(tab?.title || "");
        return url.startsWith("https://a.shopling.co.kr/") || /샵플링|shopling/i.test(title);
      });
      if (shoplingish) await chrome.windows.remove(win.id).catch(() => null);
    }
  }

  async function inspectTab(tabId) {
    try {
      return await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
          const text = norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || "");
          const processing = /처리중입니다/i.test(text)
            || /잠시만\s*기다려주시기\s*바랍니다/i.test(text);
          const resultHeading = /쇼핑몰\s*상품\s*수정\s*전송\s*결과/i.test(text)
            || /상품\s*수정\s*전송\s*결과/i.test(text);
          const hasTotals = /총건수\s*[:：]?\s*\d+/i.test(text)
            && /성공건수\s*[:：]?\s*\d+/i.test(text)
            && /실패건수\s*[:：]?\s*\d+/i.test(text);
          const hasOutcomeRows = /성공여부/i.test(text) && /쇼핑몰상품코드/i.test(text);
          const completionFooter = /상품\s*수정\s*전송이\s*완료되었습니다/i.test(text)
            || /상품\s*수정\s*전송\s*완료/i.test(text);
          const resultEvidence = resultHeading || hasTotals || hasOutcomeRows || completionFooter;
          const successMatches = text.match(/성공건수\s*[:：]?\s*\d+/gi) || [];
          const failureMatches = text.match(/실패건수\s*[:：]?\s*\d+/gi) || [];
          return {
            href: String(location.href || ""),
            title: String(document.title || ""),
            readyState: String(document.readyState || ""),
            processing,
            resultEvidence,
            completionFooter,
            bodyLength: text.length,
            successBlockCount: successMatches.length,
            failureBlockCount: failureMatches.length,
          };
        },
      });
    } catch {
      return [];
    }
  }

  async function resultCandidates(job) {
    const windows = await chrome.windows.getAll({ populate: true }).catch(() => []);
    const candidates = [];
    let inaccessiblePopupCount = 0;

    for (const win of windows) {
      for (const tab of win.tabs || []) {
        if (!Number.isInteger(tab?.id)) continue;
        if (tab.id === job?.popupTabId || tab.id === job?.workerTabId || tab.id === job?.sourceTabId) continue;

        const rows = await inspectTab(tab.id);
        const readable = rows.filter((row) => row?.result);
        const resultRows = readable.filter((row) => row.result.resultEvidence === true);
        if (!resultRows.length) {
          if (win.type === "popup" && /샵플링|shopling/i.test(String(tab.title || "")) && readable.length === 0) {
            inaccessiblePopupCount += 1;
          }
          continue;
        }

        const processing = resultRows.some((row) => row.result.processing === true);
        const ready = resultRows.every((row) => row.result.readyState === "complete");
        const footer = resultRows.some((row) => row.result.completionFooter === true);
        const bodyLength = Math.max(...resultRows.map((row) => Number(row.result.bodyLength || 0)));
        const successBlockCount = Math.max(...resultRows.map((row) => Number(row.result.successBlockCount || 0)));
        const failureBlockCount = Math.max(...resultRows.map((row) => Number(row.result.failureBlockCount || 0)));

        candidates.push({
          tabId: tab.id,
          windowId: win.id,
          windowType: win.type,
          title: String(tab.title || resultRows[0]?.result?.title || ""),
          url: String(tab.url || resultRows[0]?.result?.href || ""),
          processing,
          ready,
          footer,
          bodyLength,
          successBlockCount,
          failureBlockCount,
        });
      }
    }

    return { candidates, inaccessiblePopupCount };
  }

  function signature(candidate) {
    return [
      candidate.tabId,
      candidate.bodyLength,
      candidate.successBlockCount,
      candidate.failureBlockCount,
      candidate.footer ? 1 : 0,
    ].join(":");
  }

  async function watchResultLoading(jobId) {
    if (!jobId || activeWatchers.has(jobId)) return;
    activeWatchers.add(jobId);
    const startedAt = Date.now();
    let stableSignature = "";
    let stableSince = 0;

    try {
      while (Date.now() - startedAt < WAIT_LIMIT_MS) {
        const state = await loadState();
        const job = state?.jobs?.find((item) => item.id === jobId);
        if (!state || state.state !== "RUNNING" || !job || job.status !== "RUNNING" || state.stopped) return;
        if (!["SUBMIT_CLICKED", "RESULT_WAIT"].includes(String(job.stage || ""))) {
          await sleep(120);
          continue;
        }

        const snapshot = await resultCandidates(job);
        const candidates = snapshot.candidates;
        const loadingCandidates = candidates.filter((row) => row.processing);
        const doneCandidates = candidates.filter((row) => !row.processing && row.ready);

        if (loadingCandidates.length) {
          stableSignature = "";
          stableSince = 0;
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 결과 로딩 중 · 결과창 ${candidates.length}개 감지 · '처리중입니다' 종료 대기 v${VERSION}`;
          await saveState(state);
          await sleep(POLL_MS);
          continue;
        }

        if (doneCandidates.length) {
          const candidate = doneCandidates[0];
          const nextSignature = signature(candidate);
          if (nextSignature !== stableSignature) {
            stableSignature = nextSignature;
            stableSince = Date.now();
          }
          const stableMs = Date.now() - stableSince;
          job.resultTabId = candidate.tabId;
          job.resultWindowId = candidate.windowId;
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 로딩 종료 감지 · 결과화면 안정화 ${Math.min(stableMs, STABLE_MS)}/${STABLE_MS}ms · footer 검증 불필요 v${VERSION}`;
          await saveState(state);

          if (stableMs >= STABLE_MS) {
            await completeJob(
              job.id,
              `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 처리 완료 · Shopling 결과창 로딩 종료 + 결과표 안정화 확인 · 마켓 성공/실패/완료 footer 검증 없음 v${VERSION}`,
            );
            return;
          }
        } else {
          stableSignature = "";
          stableSince = 0;
          job.message = snapshot.inaccessiblePopupCount > 0
            ? `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 팝업 ${snapshot.inaccessiblePopupCount}개 보이나 결과 DOM 접근 대기 · 로딩 종료 감지 준비 v${VERSION}`
            : `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 결과창/결과표 생성 대기 · 로딩 종료 감지 준비 v${VERSION}`;
          await saveState(state);
        }

        await sleep(POLL_MS);
      }

      const state = await loadState();
      const job = state?.jobs?.find((item) => item.id === jobId);
      if (state && job && job.status === "RUNNING") {
        await failJob(job.id, "V035_LOADING_END_TIMEOUT", "Shopling 결과창의 로딩 종료를 20분 동안 확인하지 못했습니다.");
      }
    } finally {
      activeWatchers.delete(jobId);
    }
  }

  const baseStartRun = startRun;
  startRun = async function startRunV035(sourceTabId, testMode = false) {
    await closeStaleShoplingPopupWindows(sourceTabId);
    const result = await baseStartRun(sourceTabId, testMode);
    const state = await loadState();
    if (state) {
      state.version = VERSION;
      state.resultPolicy = "LOADING_END_AND_RESULT_STABLE";
      await saveState(state);
      return publicState(state);
    }
    return result;
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "A21_STAGE"
        && ["SUBMIT_CLICKED", "RESULT_WAIT"].includes(String(message.stage || ""))
        && message.jobId) {
      setTimeout(() => void watchResultLoading(String(message.jobId)), 20);
    }
    return false;
  });
})();

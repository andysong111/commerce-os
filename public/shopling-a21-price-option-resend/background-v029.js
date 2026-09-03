importScripts("background-v028.js");

(() => {
  const VERSION = "0.2.9";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  const SHOPLING_ORIGIN = "https://a.shopling.co.kr/";
  const POLL_MS = 500;
  const CLEAR_GRACE_MS = 2_000;
  const WAIT_LIMIT_MS = 20 * 60 * 1000;
  const activeWatchers = new Set();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isShopling = (url) => String(url || "").startsWith(SHOPLING_ORIGIN);

  async function loadState() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function saveState(state) {
    if (!state) return null;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  async function inspectTab(tabId) {
    try {
      return await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const norm = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
          const visible = (element) => {
            if (!(element instanceof Element)) return false;
            const style = getComputedStyle(element);
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || 1) === 0) return false;
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          };
          let processing = false;
          const nodes = document.querySelectorAll("div,section,article,p,span,td,strong,b");
          for (const node of nodes) {
            if (!visible(node)) continue;
            const text = norm(node.textContent || "");
            if (!text || text.length > 220) continue;
            if (/처리중입니다/.test(text) || /잠시만\s*기다려주시기\s*바랍니다/.test(text)) {
              processing = true;
              break;
            }
          }
          const bodyText = norm(document.body?.innerText || document.body?.textContent || "");
          const resultEvidence = /쇼핑몰\s*상품\s*수정\s*전송\s*결과|성공건수|실패건수|총건수\s*[:：]/i.test(bodyText);
          return { processing, resultEvidence, href: location.href };
        },
      });
    } catch {
      return [];
    }
  }

  function candidateTabs(state, job, tabs) {
    const baseline = new Set(Array.isArray(state.runBaselineShoplingTabIds) ? state.runBaselineShoplingTabIds : []);
    const preferredIds = new Set([job.popupTabId, job.workerTabId, job.resultTabId].filter(Number.isInteger));
    return tabs.filter((tab) => {
      if (!Number.isInteger(tab.id) || !isShopling(tab.url)) return false;
      if (preferredIds.has(tab.id)) return true;
      if (tab.openerTabId === job.popupTabId || tab.openerTabId === job.workerTabId) return true;
      return !baseline.has(tab.id);
    });
  }

  async function watchLoading(jobId) {
    if (activeWatchers.has(jobId)) return;
    activeWatchers.add(jobId);
    const startedAt = Date.now();
    let clearSince = 0;
    let sawResultPage = false;

    try {
      while (Date.now() - startedAt < WAIT_LIMIT_MS) {
        const state = await loadState();
        const job = state?.jobs?.find((item) => item.id === jobId);
        if (!state || state.state !== "RUNNING" || !job || job.status !== "RUNNING") return;
        if (job.stage !== "RESULT_WAIT") {
          await sleep(100);
          continue;
        }

        const tabs = await chrome.tabs.query({});
        const candidates = candidateTabs(state, job, tabs);
        let foundEvidence = false;
        let foundProcessing = false;
        let evidenceTabId = null;

        for (const tab of candidates) {
          const rows = await inspectTab(tab.id);
          for (const row of rows) {
            const result = row?.result;
            if (!result?.resultEvidence) continue;
            foundEvidence = true;
            evidenceTabId = tab.id;
            if (result.processing) foundProcessing = true;
          }
        }

        if (foundEvidence) {
          sawResultPage = true;
          if (Number.isInteger(evidenceTabId)) job.resultTabId = evidenceTabId;
        }

        if (foundProcessing) {
          clearSince = 0;
          job.sawShoplingProcessing = true;
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 처리중 · Shopling 로딩 완료 대기 · 결과 성공/실패 검증 없음 v${VERSION}`;
          await saveState(state);
          await sleep(POLL_MS);
          continue;
        }

        if (foundEvidence || sawResultPage) {
          if (!clearSince) clearSince = Date.now();
          const clearForMs = Date.now() - clearSince;
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 결과화면 확인 · 처리중 로딩 종료 안정화 ${Math.min(clearForMs, CLEAR_GRACE_MS)}/${CLEAR_GRACE_MS}ms`;
          await saveState(state);
          if (clearForMs >= CLEAR_GRACE_MS) {
            await completeJob(
              job.id,
              `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 처리 완료 · Shopling 결과화면 + 처리중 로딩 종료 직접 확인 · 마켓 성공/실패 검증 없음 v${VERSION}`,
            );
            return;
          }
        }

        await sleep(POLL_MS);
      }

      const state = await loadState();
      const job = state?.jobs?.find((item) => item.id === jobId);
      if (state && job && job.status === "RUNNING") {
        await failJob(job.id, "V029_LOADING_TIMEOUT", "Shopling 처리중 로딩 종료를 20분 동안 확인하지 못했습니다.");
      }
    } finally {
      activeWatchers.delete(jobId);
    }
  }

  // v0.2.8 content observer가 브라우저/프레임 상태 때문에 결과 종료 이벤트를 놓쳐도,
  // v0.2.9는 service worker가 Shopling 탭을 직접 폴링해서 결과화면과 로딩 소멸을 확인한다.
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "A21_STAGE" && String(message.stage || "") === "RESULT_WAIT" && message.jobId) {
      setTimeout(() => void watchLoading(String(message.jobId)), 25);
      return false;
    }
    return false;
  });
})();

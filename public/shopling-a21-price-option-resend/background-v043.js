importScripts("background-v041.js");

(() => {
  const VERSION = "0.4.3";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  const POLL_MS = 500;
  const STABLE_MS = 2_500;
  const WAIT_LIMIT_MS = 30 * 60 * 1000;
  const DEBUGGER_VERSION = "1.3";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loadStateV043() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function saveStateV043(state) {
    if (!state) return null;
    state.version = VERSION;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  async function attachV043(tabId) {
    try {
      await chrome.debugger.attach({ tabId }, DEBUGGER_VERSION);
      await chrome.debugger.sendCommand({ tabId }, "Runtime.enable").catch(() => null);
      await chrome.debugger.sendCommand({ tabId }, "Page.enable").catch(() => null);
      return true;
    } catch (error) {
      const message = String(error?.message || error || "");
      if (/already attached|another debugger/i.test(message)) return true;
      return false;
    }
  }

  async function detachV043(tabId) {
    if (!Number.isInteger(tabId)) return;
    await chrome.debugger.detach({ tabId }).catch(() => null);
  }

  const DEFINITIVE_EXPRESSION = `(() => {
    try {
      const norm = (v) => String(v ?? '').normalize('NFKC').replace(/\\s+/g, ' ').trim();
      try { window.scrollTo(0, Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0)); } catch {}
      try {
        for (const el of document.querySelectorAll('*')) {
          if (el && el.scrollHeight > el.clientHeight + 16) el.scrollTop = el.scrollHeight;
        }
      } catch {}
      const text = norm(document.body?.innerText || document.body?.textContent || document.documentElement?.innerText || '');
      const processing = /처리중입니다/i.test(text) || /잠시만\\s*기다려주시기\\s*바랍니다/i.test(text);
      const priceFooter = /상품\\s*수정\\s*전송이\\s*완료되었습니다/i.test(text) || /상품\\s*수정\\s*전송\\s*완료/i.test(text);
      const optionFooter = /상품\\s*옵션\\s*수정\\s*전송이\\s*완료되었습니다/i.test(text) || /상품\\s*옵션\\s*수정\\s*전송\\s*완료/i.test(text);
      const footer = priceFooter || optionFooter;
      const resultHeading = /쇼핑몰\\s*상품(?:\\s*옵션)?\\s*수정\\s*전송\\s*결과/i.test(text) || /상품(?:\\s*옵션)?\\s*수정\\s*전송\\s*결과/i.test(text);
      return {
        ok: true,
        processing,
        footer,
        priceFooter,
        optionFooter,
        resultHeading,
        readyState: String(document.readyState || ''),
        scrollY: Number(window.scrollY || document.documentElement?.scrollTop || document.body?.scrollTop || 0),
        scrollHeight: Number(Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0)),
        href: String(location.href || ''),
        title: String(document.title || ''),
        textLength: text.length,
      };
    } catch (error) {
      return { ok: false, error: String(error?.message || error || 'evaluate failed') };
    }
  })()`;

  async function probeDefinitive(tabId) {
    if (!Number.isInteger(tabId)) return { ok: false, error: "result tab missing" };
    const attached = await attachV043(tabId);
    if (!attached) return { ok: false, error: `tab ${tabId} debugger attach failed` };
    try {
      const response = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: DEFINITIVE_EXPRESSION,
        returnByValue: true,
        awaitPromise: false,
      });
      const value = response?.result?.value;
      if (!value || typeof value !== "object") return { ok: false, error: `tab ${tabId} no top-document value` };
      return value;
    } catch (error) {
      return { ok: false, error: String(error?.message || error || "evaluate failed") };
    }
  }

  const baseCompleteJobV041 = completeJob;

  completeJob = async function completeJobV043(jobId, priorMessage) {
    const initialState = await loadStateV043();
    const initialJob = initialState?.jobs?.find((item) => item.id === jobId);
    if (!initialState || !initialJob || initialJob.status !== "RUNNING") {
      return baseCompleteJobV041(jobId, priorMessage);
    }

    if (String(initialJob.stage || "") !== "RESULT_WAIT") {
      return baseCompleteJobV041(jobId, priorMessage);
    }

    const resultTabId = Number(initialJob.resultTabId);
    const startedAt = Date.now();
    let stableSince = 0;

    while (Date.now() - startedAt < WAIT_LIMIT_MS) {
      const state = await loadStateV043();
      const job = state?.jobs?.find((item) => item.id === jobId);
      if (!state || state.state !== "RUNNING" || state.stopped || !job || job.status !== "RUNNING") {
        await detachV043(resultTabId);
        return;
      }

      const probe = await probeDefinitive(resultTabId);
      if (!probe?.ok) {
        stableSince = 0;
        job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 조기완료 차단 · 실제 결과창 최종완료 확인 대기 · ${probe?.error || "CDP read retry"} v${VERSION}`;
        await saveStateV043(state);
        await sleep(POLL_MS);
        continue;
      }

      if (probe.processing) {
        stableSince = 0;
        job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 조기완료 차단 · Shopling 처리중 로딩 확인 · 끝날 때까지 대기 v${VERSION}`;
        await saveStateV043(state);
        await sleep(POLL_MS);
        continue;
      }

      const expectedFooter = job.mode === "OPTION" ? probe.optionFooter === true : probe.priceFooter === true;
      const definitive = expectedFooter && probe.readyState === "complete";
      if (!definitive) {
        stableSince = 0;
        const expectedLabel = job.mode === "OPTION" ? "‘상품옵션 수정 전송이 완료되었습니다.’" : "‘상품 수정 전송이 완료되었습니다.’";
        const footerLabel = expectedFooter ? `${expectedLabel} 확인` : `${expectedLabel} 대기`;
        job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 조기완료 차단 · ${footerLabel} · document ${probe.readyState || "unknown"} · 다음 큐 금지 v${VERSION}`;
        await saveStateV043(state);
        await sleep(POLL_MS);
        continue;
      }

      if (!stableSince) stableSince = Date.now();
      const stableMs = Date.now() - stableSince;
      const footerName = job.mode === "OPTION" ? "상품옵션 완료 footer" : "상품 완료 footer";
      job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 최종완료 확정 중 · ${footerName} + document complete · ${Math.min(stableMs, STABLE_MS)}/${STABLE_MS}ms v${VERSION}`;
      await saveStateV043(state);

      if (stableMs >= STABLE_MS) {
        await detachV043(resultTabId);
        return baseCompleteJobV041(
          jobId,
          `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 완료 · Shopling ${footerName} + document.readyState complete 확인 후 다음 큐 진행 · 조기전환 차단 v${VERSION}`,
        );
      }
      await sleep(POLL_MS);
    }

    await detachV043(resultTabId);
    if (typeof failJob === "function") {
      return failJob(jobId, "V043_DEFINITIVE_COMPLETION_TIMEOUT", "Shopling 결과창의 작업별 최종 완료 footer와 document complete 상태를 30분 동안 확인하지 못했습니다.");
    }
  };

  const baseStartRunV041 = startRun;
  startRun = async function startRunV043(sourceTabId, testMode = false) {
    const result = await baseStartRunV041(sourceTabId, testMode);
    const state = await loadStateV043();
    if (!state) return result;
    state.version = VERSION;
    state.resultPolicy = "CDP_MODE_SPECIFIC_DEFINITIVE_FOOTER_AND_DOCUMENT_COMPLETE";
    await saveStateV043(state);
    return publicState(state);
  };
})();

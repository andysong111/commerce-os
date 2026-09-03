importScripts("background-v020.js");

(() => {
  const VERSION = "0.3.9";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  const POLL_MS = 1_500;
  const REFRESH_INTERVAL_MS = 2_500;
  const READBACK_STABLE_MS = 1_800;
  const SAME_MINUTE_FALLBACK_MS = 35_000;
  const WAIT_LIMIT_MS = 30 * 60 * 1000;
  const activeWatchers = new Set();
  const baselineCaptures = new Set();

  const sleepV039 = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loadStateV039() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function saveStateV039(state) {
    if (!state) return null;
    state.version = VERSION;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  function sortJobsPricesFirstV039(state) {
    if (!state?.jobs) return;
    state.jobs.sort((a, b) => {
      const rank = (mode) => mode === "PRICE" ? 0 : mode === "OPTION" ? 1 : 2;
      const byMode = rank(a.mode) - rank(b.mode);
      if (byMode) return byMode;
      return Number(a.batchIndex || 0) - Number(b.batchIndex || 0);
    });
  }

  monitorResult = async () => {};

  const baseStartRunV039 = startRun;
  startRun = async function startRunV039(sourceTabId, testMode = false) {
    const result = await baseStartRunV039(sourceTabId, testMode);
    const state = await loadStateV039();
    if (!state) return result;
    state.version = VERSION;
    state.resultPolicy = "A21_FINAL_TRANSMISSION_DATE_READBACK";
    sortJobsPricesFirstV039(state);
    await saveStateV039(state);
    return publicState(state);
  };

  async function pumpV039() {
    const state = await loadStateV039();
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
      next.error = "V039_WINDOW_CREATE";
      next.message = error instanceof Error ? error.message : String(error);
      await saveStateV039(state);
      await finalizeOrPump();
    }
  }
  pump = pumpV039;

  async function readFinalTransmissionRows(job) {
    if (!Number.isInteger(job?.workerTabId)) return { rows: {}, headerFound: false, frameFound: false };
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId: job.workerTabId, allFrames: true },
        args: [Array.isArray(job.goodsKeys) ? job.goodsKeys.map(String) : []],
        func: (goodsKeys) => {
          const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
          const body = normalize(document.body?.innerText || document.body?.textContent || "");
          if (!/쇼핑몰상품수정/i.test(body) || !/검색항목/i.test(body)) return { frameFound: false, headerFound: false, rows: {} };

          const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const parseStamp = (text) => {
            const raw = normalize(text);
            const match = raw.match(/(20\d{2})[.\/-]?(\d{2})[.\/-]?(\d{2})(?:\s+|T)(\d{1,2})(?::?(\d{2}))(?::?(\d{2}))?/);
            if (!match) return null;
            const [, y, mo, d, h, mi, s] = match;
            const stamp = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s || 0), 0).getTime();
            return Number.isFinite(stamp) ? stamp : null;
          };

          const output = {};
          let headerFound = false;
          for (const table of document.querySelectorAll("table")) {
            const allRows = [...table.querySelectorAll("tr")];
            if (!allRows.length) continue;
            let dateIndex = -1;
            for (const headerRow of allRows.slice(0, 6)) {
              const cells = [...headerRow.querySelectorAll("th,td")];
              const idx = cells.findIndex((cell) => /최종\s*전송일|마지막\s*전송일|최종\s*송신일/i.test(normalize(cell.textContent || "")));
              if (idx >= 0) {
                dateIndex = idx;
                headerFound = true;
                break;
              }
            }

            for (const row of allRows) {
              if (!row.querySelector('input[type="checkbox"]')) continue;
              const rowText = normalize(row.textContent || "");
              const matchedKeys = goodsKeys.filter((key) => new RegExp(`(^|\\D)${escapeRegExp(key)}(\\D|$)`).test(rowText));
              if (!matchedKeys.length) continue;
              const cells = [...row.querySelectorAll("td")];
              let raw = dateIndex >= 0 && dateIndex < cells.length ? normalize(cells[dateIndex].textContent || "") : "";
              let stamp = parseStamp(raw);
              if (!stamp) {
                const matches = [...rowText.matchAll(/20\d{2}[.\/-]?\d{2}[.\/-]?\d{2}(?:\s+|T)\d{1,2}:?\d{2}(?::?\d{2})?/g)].map((item) => item[0]);
                if (matches.length) {
                  raw = matches[matches.length - 1];
                  stamp = parseStamp(raw);
                }
              }
              for (const key of matchedKeys) {
                const prior = output[key];
                if (!prior || Number(stamp || 0) >= Number(prior.timestamp || 0)) {
                  output[key] = { raw, timestamp: stamp, rowText: rowText.slice(0, 700) };
                }
              }
            }
          }
          return { frameFound: true, headerFound, rows: output };
        },
      });
      const frames = result.map((row) => row?.result).filter(Boolean);
      const merged = {};
      let headerFound = false;
      let frameFound = false;
      for (const frame of frames) {
        if (frame.frameFound) frameFound = true;
        if (frame.headerFound) headerFound = true;
        for (const [key, value] of Object.entries(frame.rows || {})) {
          const prior = merged[key];
          if (!prior || Number(value?.timestamp || 0) >= Number(prior?.timestamp || 0)) merged[key] = value;
        }
      }
      return { rows: merged, headerFound, frameFound };
    } catch (error) {
      return { rows: {}, headerFound: false, frameFound: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async function refreshWorkerSearch(job) {
    if (!Number.isInteger(job?.workerTabId)) return false;
    try {
      const rows = await chrome.scripting.executeScript({
        target: { tabId: job.workerTabId, allFrames: true },
        args: [Array.isArray(job.goodsKeys) ? job.goodsKeys.map(String) : []],
        func: (goodsKeys) => {
          const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
          const body = normalize(document.body?.innerText || document.body?.textContent || "");
          if (!/쇼핑몰상품수정/i.test(body) || !/검색항목/i.test(body)) return false;
          const inputs = [...document.querySelectorAll('input[type="text"],textarea')].filter((input) => !input.disabled);
          const searchInput = inputs.find((input) => goodsKeys.some((key) => normalize(input.value || "").includes(String(key))))
            || inputs.find((input) => normalize((input.closest("tr") || input.parentElement)?.textContent || "").includes("검색항목"));
          if (!searchInput) return false;
          const form = searchInput.form || searchInput.closest("form") || document;
          const clickText = (element) => normalize(element instanceof HTMLInputElement ? `${element.value || ""} ${element.title || ""}` : `${element.textContent || ""} ${element.getAttribute?.("title") || ""}`);
          const buttons = [...form.querySelectorAll('button,input[type="button"],input[type="submit"],input[type="image"],a')].filter((element) => clickText(element) === "검색");
          if (!buttons.length) return false;
          const rect = searchInput.getBoundingClientRect();
          buttons.sort((a, b) => Math.abs(a.getBoundingClientRect().top - rect.top) - Math.abs(b.getBoundingClientRect().top - rect.top));
          buttons[0].click();
          return true;
        },
      });
      return rows.some((row) => row?.result === true);
    } catch {
      return false;
    }
  }

  async function captureBaseline(jobId) {
    if (!jobId || baselineCaptures.has(jobId)) return;
    baselineCaptures.add(jobId);
    try {
      await sleepV039(80);
      const state = await loadStateV039();
      const job = state?.jobs?.find((item) => item.id === jobId);
      if (!state || !job || job.status !== "RUNNING" || job.finalSendBaselineAt) return;
      const snapshot = await readFinalTransmissionRows(job);
      const latest = await loadStateV039();
      const current = latest?.jobs?.find((item) => item.id === jobId);
      if (!latest || !current || current.status !== "RUNNING" || current.finalSendBaselineAt) return;
      current.finalSendBaseline = snapshot.rows || {};
      current.finalSendBaselineAt = Date.now();
      await saveStateV039(latest);
    } finally {
      baselineCaptures.delete(jobId);
    }
  }

  function updatedGoodsKeys(job, snapshot, ackAt) {
    const keys = Array.isArray(job.goodsKeys) ? job.goodsKeys.map(String) : [];
    const baseline = job.finalSendBaseline || {};
    const ackValue = Number(ackAt || 0);
    const ackMinute = Math.floor(ackValue / 60_000) * 60_000;
    const elapsed = Date.now() - ackValue;
    const updated = [];
    const pending = [];
    const sameMinuteFallback = [];
    for (const key of keys) {
      const current = snapshot.rows?.[key];
      const before = baseline?.[key];
      const currentTs = Number(current?.timestamp || 0);
      const beforeTs = Number(before?.timestamp || 0);
      const changed = currentTs > 0 && beforeTs > 0 && currentTs > beforeTs;
      const recentWithoutBaseline = currentTs > 0 && beforeTs <= 0 && currentTs >= ackMinute;
      const sameMinuteSafe = currentTs > 0
        && beforeTs > 0
        && currentTs === beforeTs
        && currentTs >= ackMinute
        && elapsed >= SAME_MINUTE_FALLBACK_MS;
      if (changed || recentWithoutBaseline || sameMinuteSafe) {
        updated.push(key);
        if (sameMinuteSafe && !changed) sameMinuteFallback.push(key);
      } else {
        pending.push(key);
      }
    }
    return { updated, pending, sameMinuteFallback };
  }

  async function watchFinalTransmissionDate(jobId) {
    if (!jobId || activeWatchers.has(jobId)) return;
    activeWatchers.add(jobId);
    const startedAt = Date.now();
    let lastRefreshAt = 0;
    let allUpdatedSince = 0;

    try {
      while (Date.now() - startedAt < WAIT_LIMIT_MS) {
        const state = await loadStateV039();
        const job = state?.jobs?.find((item) => item.id === jobId);
        if (!state || state.state !== "RUNNING" || !job || job.status !== "RUNNING" || state.stopped) return;
        if (String(job.stage || "") !== "RESULT_WAIT") {
          await sleepV039(120);
          continue;
        }

        if (!job.submitAckAt) {
          job.submitAckAt = Date.now();
          await saveStateV039(state);
        }

        if (Date.now() - lastRefreshAt >= REFRESH_INTERVAL_MS) {
          await refreshWorkerSearch(job);
          lastRefreshAt = Date.now();
          await sleepV039(900);
        }

        const snapshot = await readFinalTransmissionRows(job);
        const status = updatedGoodsKeys(job, snapshot, job.submitAckAt || startedAt);
        if (status.pending.length === 0 && status.updated.length === job.goodsKeys.length && job.goodsKeys.length > 0) {
          if (!allUpdatedSince) allUpdatedSince = Date.now();
          const stableMs = Date.now() - allUpdatedSince;
          const fallbackText = status.sameMinuteFallback.length
            ? ` · 동일 분 단위 ${status.sameMinuteFallback.length}건 ${Math.round(SAME_MINUTE_FALLBACK_MS / 1000)}초 안전대기 적용`
            : "";
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 최종전송일 갱신 확인 ${status.updated.length}/${job.goodsKeys.length}${fallbackText} · 안정화 ${Math.min(stableMs, READBACK_STABLE_MS)}/${READBACK_STABLE_MS}ms v${VERSION}`;
          await saveStateV039(state);
          if (stableMs >= READBACK_STABLE_MS) {
            await completeJob(
              job.id,
              `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 완료 · A21 최종전송일 최근시간 갱신 ${status.updated.length}/${job.goodsKeys.length} 확인 · 마켓별 결과 검증 없음 v${VERSION}`,
            );
            return;
          }
        } else {
          allUpdatedSince = 0;
          const diagnostic = snapshot.error
            ? `DOM 조회 오류 ${snapshot.error}`
            : !snapshot.frameFound
              ? "A21 목록 프레임 재조회 대기"
              : !snapshot.headerFound
                ? "최종전송일 헤더 직접 매핑 실패 · 행 날짜 fallback 사용"
                : "A21 최종전송일 재조회 중";
          job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} ${diagnostic} · 갱신 ${status.updated.length}/${job.goodsKeys.length} · 대기 ${status.pending.length} v${VERSION}`;
          await saveStateV039(state);
        }

        await sleepV039(POLL_MS);
      }

      const state = await loadStateV039();
      const job = state?.jobs?.find((item) => item.id === jobId);
      if (state && job && job.status === "RUNNING") {
        await failJob(job.id, "V039_FINAL_SEND_READBACK_TIMEOUT", "A21 최종전송일이 최근시간으로 갱신된 것을 30분 동안 확인하지 못했습니다.");
      }
    } finally {
      activeWatchers.delete(jobId);
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "A21_STAGE" && message.jobId) {
      const stageName = String(message.stage || "");
      if (stageName === "POPUP_OPENING" || stageName === "POPUP_CONFIG" || stageName === "SUBMIT_CLICKED") {
        setTimeout(() => void captureBaseline(String(message.jobId)), 0);
      }
      if (stageName === "RESULT_WAIT") {
        setTimeout(async () => {
          const state = await loadStateV039();
          const job = state?.jobs?.find((item) => item.id === String(message.jobId));
          if (state && job && job.status === "RUNNING" && !job.submitAckAt) {
            job.submitAckAt = Date.now();
            await saveStateV039(state);
          }
          void watchFinalTransmissionDate(String(message.jobId));
        }, 30);
      }
    }
    if (message?.type === "A21_GET_STATE") {
      setTimeout(async () => {
        const state = await loadStateV039();
        const running = state?.jobs?.find((job) => job.status === "RUNNING" && String(job.stage || "") === "RESULT_WAIT");
        if (running) void watchFinalTransmissionDate(running.id);
      }, 0);
    }
    return false;
  });
})();

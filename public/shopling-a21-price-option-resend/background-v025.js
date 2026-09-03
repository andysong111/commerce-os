importScripts("background-v024.js");

(() => {
  const TRACKER_VERSION = "0.2.5";
  const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV020";
  const RESULT_WAIT_MS = 180_000;
  const RETRY_MS = 400;
  const SHOPLING_ORIGIN = "https://a.shopling.co.kr/";

  const GROUP_MALLS = {
    "도매1": ["SMALL_00014", "SMALL_00069", "SMALL_00071", "SMALL_00107", "SMALL_00116", "SMALL_00165", "SMALL_00179", "SMALL_00180", "SMALL_00188", "SMALL_00190"],
    "도매2": ["SMALL_00069", "SMALL_00107", "SMALL_00116", "SMALL_00165"],
    "도매3": ["SMALL_00069", "SMALL_00107", "SMALL_00116", "SMALL_00165"],
    "도매4": ["SMALL_00069"],
    "소매1": ["SMALL_00001", "SMALL_00002", "SMALL_00003", "SMALL_00004", "SMALL_00005", "SMALL_00012", "SMALL_00019", "SMALL_00101", "SMALL_00112", "SMALL_00130", "SMALL_00168", "SMALL_00194"],
    "소매2": ["SMALL_00001", "SMALL_00002", "SMALL_00003", "SMALL_00012", "SMALL_00194"],
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isShopling = (url) => String(url || "").startsWith(SHOPLING_ORIGIN);

  async function loadStateV025() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || null;
  }

  async function saveStateV025(state) {
    if (!state) return null;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  async function enrichRunBaseline() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const state = await loadStateV025();
      if (state?.state === "RUNNING") {
        const tabs = await chrome.tabs.query({});
        state.runBaselineShoplingTabIds = tabs
          .filter((tab) => Number.isInteger(tab.id) && isShopling(tab.url))
          .map((tab) => tab.id);
        state.runBaselineCapturedAt = Date.now();
        try {
          const plan = await fetchPlan();
          const groupByGoodsKey = new Map((plan?.rows || []).map((row) => [String(row.goodsKey), String(row.productGroup || "")]));
          for (const job of state.jobs || []) {
            const expected = new Set();
            for (const goodsKey of job.goodsKeys || []) {
              const group = groupByGoodsKey.get(String(goodsKey));
              for (const mallKey of GROUP_MALLS[group] || []) expected.add(mallKey);
            }
            job.expectedResultSectionCount = expected.size;
            job.resultTrackerVersion = TRACKER_VERSION;
          }
        } catch {
          // 결과창 자체의 총건수/성공건수/실패건수 집계로도 검증 가능하므로 계획 보강 실패는 비치명적이다.
        }
        await saveStateV025(state);
        return;
      }
      await sleep(100);
    }
  }

  async function inspectResultV025(tabId) {
    const rows = await executeAllFrames(tabId, () => {
      const raw = String(document.body?.innerText || document.body?.textContent || "");
      const text = raw.normalize("NFKC").replace(/\r/g, "");
      const number = (value) => Number(String(value || "0").replace(/,/g, "")) || 0;
      const matches = (pattern, source) => [...source.matchAll(pattern)].map((match) => number(match[1]));
      const totalMatches = matches(/총건수\s*[:：]?\s*([\d,]+)/gi, text);
      const successMatches = matches(/성공건수\s*[:：]?\s*([\d,]+)/gi, text);
      const failureMatches = matches(/실패건수\s*[:：]?\s*([\d,]+)/gi, text);

      const marker = /쇼핑몰명\s*\(ID\)\s*[:：]\s*/gi;
      const markerRows = [...text.matchAll(marker)];
      const sections = [];
      for (let index = 0; index < markerRows.length; index += 1) {
        const start = (markerRows[index].index || 0) + markerRows[index][0].length;
        const end = index + 1 < markerRows.length ? (markerRows[index + 1].index || text.length) : text.length;
        const chunk = text.slice(start, end).trim();
        const firstLine = (chunk.split("\n")[0] || "").trim();
        const mallName = firstLine
          .replace(/\s+상품\s*수정\s*전송.*$/i, "")
          .replace(/\s*\(andy\d+\).*$/i, "")
          .trim()
          .slice(0, 100) || `mall-${index + 1}`;
        const total = number(chunk.match(/총건수\s*[:：]?\s*([\d,]+)/i)?.[1]);
        const success = number(chunk.match(/성공건수\s*[:：]?\s*([\d,]+)/i)?.[1]);
        const failure = number(chunk.match(/실패건수\s*[:：]?\s*([\d,]+)/i)?.[1]);
        let message = "";
        if (failure > 0) {
          const consumer = chunk.match(/.{0,80}소비자가.{0,160}/i)?.[0];
          const failureMessage = chunk.match(/실패메(?:세|시)지[\s\S]{0,260}/i)?.[0];
          message = String(consumer || failureMessage || chunk.slice(-260)).replace(/\s+/g, " ").trim().slice(0, 260);
        }
        sections.push({ mallName, total, success, failure, message });
      }

      const total = sections.length ? sections.reduce((sum, row) => sum + row.total, 0) : totalMatches.reduce((sum, value) => sum + value, 0);
      const success = sections.length ? sections.reduce((sum, row) => sum + row.success, 0) : successMatches.reduce((sum, value) => sum + value, 0);
      const failure = sections.length ? sections.reduce((sum, row) => sum + row.failure, 0) : failureMatches.reduce((sum, value) => sum + value, 0);
      const sectionCount = sections.length || Math.max(totalMatches.length, successMatches.length, failureMatches.length);
      const complete = total > 0 && success + failure >= total;
      const failures = sections.filter((row) => row.failure > 0);
      return {
        href: location.href,
        title: document.title || "",
        sectionCount,
        total,
        success,
        failure,
        complete,
        failures,
        resultEvidence: sectionCount > 0 || /성공여부\s*[:：]?\s*(성공|실패)/i.test(text),
        text: text.replace(/\s+/g, " ").trim().slice(0, 1800),
      };
    });
    return rows.map((row) => row?.result).filter(Boolean);
  }

  async function candidateTabs(job, state) {
    const tabs = await chrome.tabs.query({});
    const baseline = new Set((state.runBaselineShoplingTabIds || []).filter(Number.isInteger));
    const tracked = new Set([
      job.popupTabId,
      job.workerTabId,
      ...(Array.isArray(job.resultTabIds) ? job.resultTabIds : []),
    ].filter(Number.isInteger));
    return tabs.filter((tab) => {
      if (!Number.isInteger(tab.id) || !isShopling(tab.url)) return false;
      return tracked.has(tab.id) || !baseline.has(tab.id);
    });
  }

  function bestEvidence(rows) {
    return (rows || [])
      .filter((row) => row?.resultEvidence)
      .sort((left, right) => {
        if (right.sectionCount !== left.sectionCount) return right.sectionCount - left.sectionCount;
        if (right.total !== left.total) return right.total - left.total;
        return (right.success + right.failure) - (left.success + left.failure);
      })[0] || null;
  }

  function failureSummary(row) {
    const details = (row.failures || []).map((item) => {
      const message = String(item.message || "").trim();
      return `${item.mallName}${message ? ` · ${message}` : ""}`;
    });
    return details.length ? details.join(" | ").slice(0, 900) : `실패 ${row.failure || 1}건`;
  }

  async function updateProgress(jobId, row, expectedSections) {
    const state = await loadStateV025();
    const job = state?.jobs?.find((item) => item.id === jobId);
    if (!state || !job || job.status !== "RUNNING") return;
    job.resultObservedSectionCount = row.sectionCount;
    job.resultObservedTotal = row.total;
    job.resultObservedSuccess = row.success;
    job.resultObservedFailure = row.failure;
    job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 결과 집계 중 · 쇼핑몰 ${row.sectionCount}${expectedSections ? `/${expectedSections}` : ""} · 성공 ${row.success} · 실패 ${row.failure}`;
    await saveStateV025(state);
  }

  async function monitorResultV025(jobId) {
    const deadline = Date.now() + RESULT_WAIT_MS;
    while (Date.now() < deadline) {
      const state = await loadStateV025();
      const job = state?.jobs?.find((item) => item.id === jobId);
      if (!state || !job || job.status !== "RUNNING") return;
      if (!["SUBMIT_CLICKED", "RESULT_WAIT"].includes(job.stage)) return;

      const tabs = await candidateTabs(job, state);
      const evidence = [];
      for (const tab of tabs) {
        const rows = await inspectResultV025(tab.id);
        evidence.push(...rows);
      }
      const best = bestEvidence(evidence);
      if (best) {
        const expectedSections = Number(job.expectedResultSectionCount || 0);
        await updateProgress(job.id, best, expectedSections);
        const enoughSections = expectedSections > 0 ? best.sectionCount >= expectedSections : best.sectionCount > 0;
        if (best.complete && enoughSections) {
          if (best.failure > 0) {
            await failJob(
              job.id,
              "V025_RESULT_PARTIAL_FAILURE",
              `${job.mode === "PRICE" ? "판매가" : "옵션"} Shopling 마켓별 결과 · 성공 ${best.success} · 실패 ${best.failure} · ${failureSummary(best)}`,
            );
            return;
          }
          await completeJob(
            job.id,
            `${job.mode === "PRICE" ? "판매가" : "옵션"} 수정전송 성공 확인 · 쇼핑몰 ${best.sectionCount}개 · 성공 ${best.success} · 실패 0`,
          );
          return;
        }
      }
      await sleep(RETRY_MS);
    }

    const finalState = await loadStateV025();
    const finalJob = finalState?.jobs?.find((item) => item.id === jobId);
    if (!finalJob || finalJob.status !== "RUNNING") return;
    await failJob(
      jobId,
      "V025_RESULT_TIMEOUT",
      "Shopling 결과창/탭/프레임을 180초 동안 추적했지만 모든 쇼핑몰의 총건수·성공건수·실패건수 집계를 완료하지 못했습니다.",
    );
  }

  monitorResult = monitorResultV025;

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "A21_START") {
      setTimeout(() => void enrichRunBaseline(), 250);
      return false;
    }
    if (message?.type === "A21_STAGE" && ["SUBMIT_CLICKED", "RESULT_WAIT"].includes(String(message.stage || "")) && message.jobId) {
      setTimeout(() => void monitorResult(String(message.jobId)), 250);
      return false;
    }
    return false;
  });

  chrome.tabs.onCreated.addListener((tab) => {
    if (!Number.isInteger(tab.id)) return;
    setTimeout(() => {
      void (async () => {
        const state = await loadStateV025();
        const job = state?.jobs?.find((item) => item.status === "RUNNING" && ["SUBMIT_CLICKED", "RESULT_WAIT"].includes(item.stage));
        if (!state || !job) return;
        const latest = await chrome.tabs.get(tab.id).catch(() => null);
        if (!latest || !isShopling(latest.url)) return;
        const resultTabs = new Set(Array.isArray(job.resultTabIds) ? job.resultTabIds.filter(Number.isInteger) : []);
        resultTabs.add(tab.id);
        job.resultTabIds = [...resultTabs];
        job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 새 Shopling 결과 후보창 감지`;
        await saveStateV025(state);
        setTimeout(() => void monitorResult(job.id), 150);
      })();
    }, 150);
  });
})();

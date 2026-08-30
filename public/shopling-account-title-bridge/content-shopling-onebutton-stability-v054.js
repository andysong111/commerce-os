(() => {
  "use strict";

  const PIPE_REPORT_MESSAGE = "commerce-os-shopling-pipeline-report";
  const PIPE_MARKET_START_MESSAGE = "commerce-os-shopling-pipeline-market-start";
  const TITLE_BATCH_PROGRESS_MESSAGE = "commerce-os-shopling-title-batch-progress";
  const PIPE_MARKET_PROGRESS_MESSAGE = "commerce-os-shopling-pipeline-market-progress";
  const PIPE_UI_RUN_KEY = "commerceOsShoplingPipelineUiRun";
  const TITLE_LAST_RUN_KEY = "commerceOsShoplingTitleBatchLastRun";
  const MARKET_LAST_RUN_KEY = "commerceOsShoplingPipelineMarketLastRun";
  const PANEL_ID = "commerce-os-shopling-onebutton-panel";
  const STATUS_ID = `${PANEL_ID}-status`;
  const BUTTON_ID = `${PANEL_ID}-button`;
  const POLL_MS = 4000;
  const TRANSITION_STALE_MS = 15000;

  let advancing = false;

  function text(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function sendRuntimeMessage(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(payload, (response) => {
          void chrome.runtime.lastError;
          resolve(response || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  async function loadSession(key) {
    try {
      const stored = await chrome.storage.session.get(key);
      return stored?.[key] || null;
    } catch {
      return null;
    }
  }

  async function saveUiRun(run) {
    try {
      if (!run) await chrome.storage.session.remove(PIPE_UI_RUN_KEY);
      else await chrome.storage.session.set({ [PIPE_UI_RUN_KEY]: run });
    } catch {
      // Supabase market ledger remains the source of truth.
    }
  }

  async function loadLocal(key) {
    try {
      const stored = await chrome.storage.local.get(key);
      return stored?.[key] || null;
    } catch {
      return null;
    }
  }

  function setPanelStatus(message, kind = "info") {
    const node = document.getElementById(STATUS_ID);
    if (!node) return;
    node.textContent = message;
    node.style.color = kind === "error" ? "#b91c1c" : kind === "success" ? "#166534" : "#475569";
  }

  function setPanelBusy(busy, label = "") {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.disabled = Boolean(busy);
    button.style.opacity = busy ? "0.6" : "1";
    button.textContent = label || (busy ? "신규상품 자동처리 진행 중..." : "신규상품 전체 자동처리 · 동시 2창");
  }

  function expectedGoodsKeys(uiRun) {
    return [...new Set((Array.isArray(uiRun?.goodsKeys) ? uiRun.goodsKeys : [])
      .map(text)
      .filter((value) => /^\d{5,9}$/.test(value)))]
      .sort();
  }

  function lastTitleResultMap(lastRun) {
    const map = new Map();
    for (const raw of Array.isArray(lastRun?.itemResults) ? lastRun.itemResults : []) {
      const goodsKey = text(raw?.goodsKey);
      if (!/^\d{5,9}$/.test(goodsKey)) continue;
      map.set(goodsKey, raw);
    }
    return map;
  }

  function titleRunCoversUiRun(uiRun, lastRun) {
    if (text(lastRun?.status) !== "completed") return false;
    const expected = expectedGoodsKeys(uiRun);
    if (!expected.length) return false;
    const results = lastTitleResultMap(lastRun);
    return expected.every((goodsKey) => results.has(goodsKey));
  }

  async function finishUiFromMarketSnapshot(uiRun, marketLast) {
    if (!uiRun || !marketLast) return false;
    if (text(marketLast.claimRunId) !== text(uiRun.runId) || text(marketLast.status) !== "completed") return false;
    setPanelBusy(false);
    setPanelStatus(
      `완료 · ${Number(marketLast.done || 0)}/${Number(marketLast.total || 0)} · 신규송신 ${Number(marketLast.sent || 0)} · 이미등록/미등록없음 ${Number(marketLast.alreadyRegistered || 0)} · 확인필요 ${Number(marketLast.confirmNeeded || 0)} · 실패 ${Number(marketLast.failed || 0)}`,
      Number(marketLast.failed || 0) || Number(marketLast.confirmNeeded || 0) ? "error" : "success",
    );
    await saveUiRun(null);
    return true;
  }

  async function ensureTitleToMarketHandoff(reason = "poll") {
    if (advancing || !document.getElementById(PANEL_ID)) return;
    const uiRun = await loadSession(PIPE_UI_RUN_KEY);
    if (!uiRun || text(uiRun.status) !== "running") return;

    const marketLast = await loadLocal(MARKET_LAST_RUN_KEY);
    if (await finishUiFromMarketSnapshot(uiRun, marketLast)) return;

    const stage = text(uiRun.stage);
    if (!["title", "market", "title-transition"].includes(stage)) return;

    if (stage === "title-transition") {
      const transitionAt = Date.parse(text(uiRun.transitionAt));
      if (Number.isFinite(transitionAt) && Date.now() - transitionAt < TRANSITION_STALE_MS) return;
      uiRun.stage = "title";
      delete uiRun.transitionAt;
      await saveUiRun(uiRun);
    }

    const lastTitle = await loadLocal(TITLE_LAST_RUN_KEY);
    if (!titleRunCoversUiRun(uiRun, lastTitle)) return;

    advancing = true;
    try {
      const fresh = await loadSession(PIPE_UI_RUN_KEY);
      if (!fresh || text(fresh.status) !== "running") return;
      const freshStage = text(fresh.stage);
      if (!["title", "market", "title-transition"].includes(freshStage)) return;

      if (fresh.marketEnsured === true && freshStage === "market") return;

      fresh.stage = "title-transition";
      fresh.transitionAt = new Date().toISOString();
      await saveUiRun(fresh);

      const results = lastTitleResultMap(lastTitle);
      const failedKeys = new Set(
        expectedGoodsKeys(fresh).filter((goodsKey) => text(results.get(goodsKey)?.outcome) === "failed"),
      );

      if (failedKeys.size) {
        for (const task of Array.isArray(fresh.tasks) ? fresh.tasks : []) {
          const goodsKey = text(task?.goodsKey);
          if (!failedKeys.has(goodsKey)) continue;
          const result = results.get(goodsKey) || {};
          await sendRuntimeMessage({
            type: PIPE_REPORT_MESSAGE,
            runId: fresh.runId,
            goodsKey,
            outcome: "title_failed",
            reasonCode: text(result.reasonCode) || "title_batch_failed",
            message: text(result.message) || "상품명 분산 단계에서 실패하여 마켓 송신을 차단했습니다.",
          });
        }
      }

      const marketTasks = (Array.isArray(fresh.tasks) ? fresh.tasks : [])
        .filter((task) => !failedKeys.has(text(task?.goodsKey)));

      if (!marketTasks.length) {
        fresh.status = "completed";
        fresh.stage = "completed";
        fresh.finishedAt = new Date().toISOString();
        await saveUiRun(fresh);
        setPanelBusy(false);
        setPanelStatus(`상품명 단계 종료 · 실패 ${failedKeys.size}건 · 마켓 송신 대상 0건`, "error");
        return;
      }

      setPanelBusy(true, "마켓 자동전송 준비 중...");
      setPanelStatus(`상품명 ${fresh.goodsKeys.length}건 확인 완료 · 마켓 ${marketTasks.length}건 전송 준비`);

      const response = await sendRuntimeMessage({
        type: PIPE_MARKET_START_MESSAGE,
        claimRunId: fresh.runId,
        tasks: marketTasks,
      });

      const alreadyRunning = /이미\s*신규상품\s*마켓\s*전송/i.test(text(response?.message));
      if (response?.ok === true || alreadyRunning) {
        fresh.stage = "market";
        fresh.marketEnsured = true;
        fresh.marketStartedAt = fresh.marketStartedAt || new Date().toISOString();
        delete fresh.transitionAt;
        await saveUiRun(fresh);
        setPanelBusy(true, `마켓 전송 0/${marketTasks.length}`);
        setPanelStatus(
          alreadyRunning
            ? `마켓 작업 복구 확인 · ${marketTasks.length}건 · 기존 2창 작업 계속 진행`
            : `마켓 자동전송 시작 · ${marketTasks.length}건 · 최대 동시 2창`,
        );
        return;
      }

      fresh.stage = "title";
      delete fresh.transitionAt;
      await saveUiRun(fresh);
      setPanelBusy(false);
      setPanelStatus(`마켓 자동전송 시작 실패: ${text(response?.message || response?.error) || reason}`, "error");
    } finally {
      advancing = false;
    }
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === TITLE_BATCH_PROGRESS_MESSAGE && text(message.status) === "completed") {
      setTimeout(() => void ensureTitleToMarketHandoff("title-completed-message"), 100);
      return;
    }
    if (message.type === PIPE_MARKET_PROGRESS_MESSAGE) {
      setTimeout(() => void ensureTitleToMarketHandoff("market-progress"), 100);
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && (changes[TITLE_LAST_RUN_KEY] || changes[MARKET_LAST_RUN_KEY])) {
      setTimeout(() => void ensureTitleToMarketHandoff("durable-storage-change"), 50);
      return;
    }
    if (areaName === "session" && changes[PIPE_UI_RUN_KEY]) {
      setTimeout(() => void ensureTitleToMarketHandoff("ui-run-change"), 50);
    }
  });

  window.addEventListener("focus", () => void ensureTitleToMarketHandoff("focus"));
  window.addEventListener("pageshow", () => void ensureTitleToMarketHandoff("pageshow"));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void ensureTitleToMarketHandoff("visible");
  });

  setInterval(() => void ensureTitleToMarketHandoff("poll"), POLL_MS);
  setTimeout(() => void ensureTitleToMarketHandoff("initial"), 500);
})();

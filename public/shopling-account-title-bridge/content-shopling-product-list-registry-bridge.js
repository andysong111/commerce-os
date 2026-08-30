(() => {
  "use strict";

  const PANEL_ID = "commerce-os-shopling-product-list-batch";
  const STATUS_ID = `${PANEL_ID}-status`;
  const BUTTON_ID = `${PANEL_ID}-button`;
  const DETAILS_ID = `${PANEL_ID}-details`;
  const RETRY_BUTTON_ID = `${PANEL_ID}-retry`;
  const TITLE_LEDGER_CLAIM_MESSAGE = "commerce-os-shopling-title-ledger-claim";
  const TITLE_LEDGER_REPORT_MESSAGE = "commerce-os-shopling-title-ledger-report";
  const TITLE_LEDGER_RETRY_MESSAGE = "commerce-os-shopling-title-ledger-retry";
  const TITLE_LEDGER_STATS_MESSAGE = "commerce-os-shopling-title-ledger-stats";
  const BATCH_START_MESSAGE = "commerce-os-shopling-title-batch-start";
  const BATCH_PROGRESS_MESSAGE = "commerce-os-shopling-title-batch-progress";
  const LAST_RUN_STORAGE_KEY = "commerceOsShoplingTitleBatchLastRun";
  const LEDGER_RUN_KEY = "commerceOsShoplingTitleLedgerUiRun";
  const CHUNK_SIZE = 500;

  function text(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function newRunId() {
    return `title-ledger-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

  async function loadUiRun() {
    try {
      const stored = await chrome.storage.session.get(LEDGER_RUN_KEY);
      return stored?.[LEDGER_RUN_KEY] || null;
    } catch {
      return null;
    }
  }

  async function saveUiRun(run) {
    try {
      if (!run) await chrome.storage.session.remove(LEDGER_RUN_KEY);
      else await chrome.storage.session.set({ [LEDGER_RUN_KEY]: run });
    } catch {
      // Server ledger remains authoritative.
    }
  }

  function looksLikeProductListUi() {
    if (location.hostname !== "a.shopling.co.kr") return false;
    const params = new URLSearchParams(location.search);
    if (params.has("prod_id") || params.get("popup") === "Y") return false;
    if (["modify", "nm_chg"].includes(params.get("mode") || "")) return false;
    const body = text(document.body?.innerText || document.body?.textContent || "");
    const listSignal = /총\s*조회수|상품그룹변경|선택상품변경|EXCEL\s*저장/i.test(body);
    if (!listSignal) return false;
    const searchSignal = [...document.querySelectorAll("select")].some((select) =>
      [...select.options].some((option) => /자사\s*상품\s*코드|자체\s*상품\s*코드|검색항목/i.test(text(option.textContent))),
    );
    return searchSignal || /상품조회수정|상품조회|검색관리/i.test(body);
  }

  function setStatus(message, kind = "info") {
    const node = document.getElementById(STATUS_ID);
    if (!node) return;
    node.textContent = message;
    node.style.color = kind === "error" ? "#b91c1c" : kind === "success" ? "#166534" : "#334155";
  }

  function setButtonBusy(busy, label = "") {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.disabled = Boolean(busy);
    button.style.opacity = busy ? "0.6" : "1";
    button.textContent = label || (busy ? "신규 미분산 처리 중..." : "미분산 상품 일괄 처리");
  }

  function setRetryState(retryable) {
    const button = document.getElementById(RETRY_BUTTON_ID);
    if (!button) return;
    const count = Math.max(0, Number(retryable || 0));
    button.style.display = count ? "block" : "none";
    button.textContent = `실패/중단건 재시도 ${count}건`;
  }

  function renderFailures(failures) {
    const host = document.getElementById(DETAILS_ID);
    if (!host) return;
    host.replaceChildren();
    const rows = Array.isArray(failures) ? failures : [];
    if (!rows.length) return;
    const details = document.createElement("details");
    details.style.cssText = "margin-top:8px;border-top:1px solid #ede9fe;padding-top:7px";
    const summary = document.createElement("summary");
    summary.textContent = `확인필요 ${rows.length}건 · goods key/사유 보기`;
    summary.style.cssText = "cursor:pointer;font-weight:700;color:#b91c1c";
    details.appendChild(summary);
    for (const failure of rows) {
      const row = document.createElement("div");
      row.style.cssText = "padding:4px 0;border-bottom:1px dotted #e2e8f0;font-size:11px;color:#475569";
      row.textContent = `${text(failure?.goodsKey) || "goods key 미상"} · ${text(failure?.message || failure?.reasonCode) || "확인 필요"}`;
      details.appendChild(row);
    }
    host.appendChild(details);
  }

  function ensurePanel() {
    if (!looksLikeProductListUi()) return;
    let box = document.getElementById(PANEL_ID);
    if (!box) {
      box = document.createElement("div");
      box.id = PANEL_ID;
      box.style.cssText = [
        "position:fixed", "right:18px", "bottom:18px", "z-index:2147483647", "width:370px",
        "padding:12px", "border:1px solid #c4b5fd", "border-radius:10px", "background:#fff",
        "box-shadow:0 8px 30px rgba(15,23,42,.18)", "font:12px/1.45 Arial,sans-serif", "color:#0f172a",
      ].join(";");
      const title = document.createElement("div");
      title.textContent = "Commerce OS · 조회상품 일괄 분산";
      title.style.cssText = "font-weight:700;margin-bottom:6px";
      const status = document.createElement("div");
      status.id = STATUS_ID;
      status.style.cssText = "margin-bottom:8px;color:#475569";
      const button = document.createElement("button");
      button.id = BUTTON_ID;
      button.type = "button";
      button.style.cssText = "width:100%;padding:9px;border:0;border-radius:7px;background:#7c3aed;color:#fff;font-weight:700;cursor:pointer";
      const details = document.createElement("div");
      details.id = DETAILS_ID;
      box.append(title, status, button, details);
      document.documentElement.appendChild(box);
    }

    const button = document.getElementById(BUTTON_ID);
    if (button && !button.disabled) button.textContent = "미분산 상품 일괄 처리";
    let retry = document.getElementById(RETRY_BUTTON_ID);
    if (!retry) {
      retry = document.createElement("button");
      retry.id = RETRY_BUTTON_ID;
      retry.type = "button";
      retry.style.cssText = "display:none;width:100%;margin-top:6px;padding:7px;border:1px solid #c4b5fd;border-radius:7px;background:#fff;color:#6d28d9;font-weight:700;cursor:pointer";
      const details = document.getElementById(DETAILS_ID);
      if (details?.parentElement) details.parentElement.insertBefore(retry, details);
      else box.appendChild(retry);
    }
  }

  async function refreshStats() {
    const run = await loadUiRun();
    if (run?.status === "running") return;
    const stats = await sendRuntimeMessage({ type: TITLE_LEDGER_STATS_MESSAGE });
    if (!stats?.ok) return;
    setRetryState(stats.retryable);
    if (Number(stats.pending || 0) === 0) {
      setStatus(`신규 미분산 0건 · 처리기준선 ${Number(stats.baseline || 0)}건 · 완료누적 ${Number(stats.completed || 0)}건`, "success");
    } else {
      setStatus(`신규 미분산 ${Number(stats.pending || 0)}건 · 이전 처리상품 자동 제외 · 화면출력/검색조건 무관`, "info");
    }
  }

  async function reportActiveResults(run) {
    let stored;
    try {
      const result = await chrome.storage.local.get(LAST_RUN_STORAGE_KEY);
      stored = result?.[LAST_RUN_STORAGE_KEY] || null;
    } catch {
      stored = null;
    }
    const itemResults = Array.isArray(stored?.itemResults) ? stored.itemResults : [];
    const byKey = new Map(itemResults.map((item) => [text(item?.goodsKey), item]));
    const responses = [];
    for (const goodsKey of run.activeGoodsKeys) {
      const item = byKey.get(goodsKey);
      const outcome = ["changed", "skipped", "failed"].includes(text(item?.outcome)) ? text(item.outcome) : "failed";
      responses.push(await sendRuntimeMessage({
        type: TITLE_LEDGER_REPORT_MESSAGE,
        runId: run.claimRunId,
        goodsKey,
        outcome,
        reasonCode: text(item?.reasonCode) || (item ? "" : "title_result_missing"),
        message: text(item?.message) || (item ? "" : "상품명 처리 결과 원본을 찾지 못해 재시도 대상으로 보관했습니다."),
      }));
    }
    return responses.every((response) => response?.ok === true);
  }

  async function claimAndStart(run) {
    const claimRunId = newRunId();
    setButtonBusy(true, "신규 미분산 확인 중...");
    const claim = await sendRuntimeMessage({
      type: TITLE_LEDGER_CLAIM_MESSAGE,
      runId: claimRunId,
      limit: CHUNK_SIZE,
    });
    if (!claim?.ok) {
      setButtonBusy(false);
      setStatus(`상품명 분산 원장 조회 실패: ${text(claim?.message || claim?.error)}`, "error");
      await saveUiRun(null);
      return;
    }

    const goodsKeys = [...new Set((Array.isArray(claim.goodsKeys) ? claim.goodsKeys : [])
      .map((value) => text(value))
      .filter((value) => /^\d{5,9}$/.test(value)))];
    if (!goodsKeys.length) {
      setButtonBusy(false);
      const finalRun = run || { completed: 0, changed: 0, skipped: 0, failed: 0, failures: [] };
      if (finalRun.completed) {
        setStatus(`완료 · 이번 신규 ${finalRun.completed}건 · 분산저장 ${finalRun.changed} · 기존정상 ${finalRun.skipped} · 확인필요 ${finalRun.failed}`, finalRun.failed ? "error" : "success");
        renderFailures(finalRun.failures || []);
      }
      await saveUiRun(null);
      await refreshStats();
      return;
    }

    const nextRun = run || {
      status: "running",
      completed: 0,
      changed: 0,
      skipped: 0,
      failed: 0,
      autoRecovered: 0,
      failures: [],
      startedAt: new Date().toISOString(),
    };
    nextRun.status = "running";
    nextRun.claimRunId = claimRunId;
    nextRun.activeGoodsKeys = goodsKeys;
    nextRun.activeTotal = goodsKeys.length;
    await saveUiRun(nextRun);
    setButtonBusy(true, `신규 분산 0/${goodsKeys.length}`);
    setStatus(`신규 미처리 goods key ${goodsKeys.length}건만 분산 검사합니다. 이전 처리상품은 열지 않습니다.`, "info");

    const batch = await sendRuntimeMessage({ type: BATCH_START_MESSAGE, goodsKeys });
    if (!batch?.ok) {
      for (const goodsKey of goodsKeys) {
        await sendRuntimeMessage({
          type: TITLE_LEDGER_REPORT_MESSAGE,
          runId: claimRunId,
          goodsKey,
          outcome: "failed",
          reasonCode: "title_batch_start_failed",
          message: text(batch?.message) || "상품명 분산 작업을 시작하지 못했습니다.",
        });
      }
      setButtonBusy(false);
      setStatus("상품명 분산 시작 실패 · 해당 건만 실패 원장에 보관했습니다.", "error");
      await saveUiRun(null);
      await refreshStats();
    }
  }

  async function runLedgerBatch() {
    const existing = await loadUiRun();
    if (existing?.status === "running") {
      setStatus("이미 신규 미분산 상품 처리가 진행 중입니다.", "error");
      return;
    }
    renderFailures([]);
    await claimAndStart(null);
  }

  async function retryFailures() {
    const existing = await loadUiRun();
    if (existing?.status === "running") return;
    const response = await sendRuntimeMessage({ type: TITLE_LEDGER_RETRY_MESSAGE, limit: CHUNK_SIZE });
    if (!response?.ok) {
      setStatus(`실패건 재시도 준비 실패: ${text(response?.message || response?.error)}`, "error");
      return;
    }
    if (!Number(response.requeued || 0)) {
      setStatus("재시도할 실패/중단건이 없습니다.", "success");
      await refreshStats();
      return;
    }
    setStatus(`실패/중단 ${Number(response.requeued)}건을 명시적으로 재시도합니다.`, "info");
    await runLedgerBatch();
  }

  document.addEventListener("click", (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const main = element?.closest(`#${BUTTON_ID}`);
    const retry = element?.closest(`#${RETRY_BUTTON_ID}`);
    if (!main && !retry) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (retry) void retryFailures();
    else void runLedgerBatch();
  }, true);

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== BATCH_PROGRESS_MESSAGE) return;
    void (async () => {
      const run = await loadUiRun();
      if (!run || run.status !== "running" || !Array.isArray(run.activeGoodsKeys)) return;
      const total = Number(message.total || run.activeTotal || 0);
      const done = Number(message.done || 0);
      if (message.status !== "completed") {
        setButtonBusy(true, `신규 분산 ${done}/${total}`);
        setStatus(`신규 상품명 분산 ${done}/${total} · 분산저장 ${Number(message.changed || 0)} · 기존정상 ${Number(message.skipped || 0)} · 확인필요 ${Number(message.failed || 0)}`, "info");
        return;
      }

      const recorded = await reportActiveResults(run);
      if (!recorded) {
        setButtonBusy(false);
        setStatus("상품명 결과의 영구 원장 기록이 일부 실패했습니다. 자동 다음 작업을 중단했습니다.", "error");
        await saveUiRun(null);
        return;
      }

      run.completed += Number(message.done || run.activeGoodsKeys.length || 0);
      run.changed += Number(message.changed || 0);
      run.skipped += Number(message.skipped || 0);
      run.failed += Number(message.failed || 0);
      run.autoRecovered += Number(message.autoRecovered || 0);
      run.failures.push(...(Array.isArray(message.failures) ? message.failures : []));
      run.activeGoodsKeys = [];
      run.activeTotal = 0;
      run.claimRunId = "";
      await saveUiRun(run);
      await claimAndStart(run);
    })();
  });

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    ensurePanel();
    if (document.getElementById(PANEL_ID) || attempts >= 30) clearInterval(timer);
  }, 400);
  ensurePanel();
  setTimeout(() => void refreshStats(), 900);
})();

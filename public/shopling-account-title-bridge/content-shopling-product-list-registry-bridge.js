(() => {
  "use strict";

  const PANEL_ID = "commerce-os-shopling-product-list-batch";
  const STATUS_ID = `${PANEL_ID}-status`;
  const BUTTON_ID = `${PANEL_ID}-button`;
  const DETAILS_ID = `${PANEL_ID}-details`;
  const TITLE_REGISTRY_MESSAGE = "commerce-os-shopling-title-registry-keys";
  const BATCH_START_MESSAGE = "commerce-os-shopling-title-batch-start";
  const BATCH_PROGRESS_MESSAGE = "commerce-os-shopling-title-batch-progress";
  const REGISTRY_RUN_KEY = "commerceOsShoplingRegistryTitleRun";
  const CHUNK_SIZE = 500;

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

  async function loadRegistryRun() {
    try {
      const stored = await chrome.storage.session.get(REGISTRY_RUN_KEY);
      return stored?.[REGISTRY_RUN_KEY] || null;
    } catch {
      return null;
    }
  }

  async function saveRegistryRun(run) {
    try {
      if (!run) await chrome.storage.session.remove(REGISTRY_RUN_KEY);
      else await chrome.storage.session.set({ [REGISTRY_RUN_KEY]: run });
    } catch {
      // UI orchestration only; title worker itself keeps its own run state.
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
    button.textContent = label || (busy ? "OPS CENTER 등록상품 확인 중..." : "미분산 상품 일괄 처리");
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
    summary.textContent = `최종 확인필요 ${rows.length}건 · goods key/사유 보기`;
    summary.style.cssText = "cursor:pointer;font-weight:700;color:#b91c1c";
    details.appendChild(summary);
    const list = document.createElement("div");
    list.style.cssText = "margin-top:6px;max-height:180px;overflow:auto;font:11px/1.5 Arial,sans-serif;color:#475569";
    for (const failure of rows) {
      const item = document.createElement("div");
      item.style.cssText = "padding:4px 0;border-bottom:1px dotted #e2e8f0";
      item.textContent = `${text(failure?.goodsKey) || "goods key 미상"} · ${text(failure?.message || failure?.reasonCode) || "확인 필요"}`;
      list.appendChild(item);
    }
    details.appendChild(list);
    host.appendChild(details);
  }

  function mountFallbackPanel() {
    if (document.getElementById(PANEL_ID) || !looksLikeProductListUi()) return;
    const box = document.createElement("div");
    box.id = PANEL_ID;
    box.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:18px",
      "z-index:2147483647",
      "width:370px",
      "padding:12px",
      "border:1px solid #c4b5fd",
      "border-radius:10px",
      "background:#ffffff",
      "box-shadow:0 8px 30px rgba(15,23,42,.18)",
      "font:12px/1.45 Arial,sans-serif",
      "color:#0f172a",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "Commerce OS · 조회상품 일괄 분산";
    title.style.cssText = "font-weight:700;margin-bottom:6px";
    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.textContent = "OPS CENTER에 등록된 goods key 기준 · 현재 조회조건/화면출력 수와 무관하게 미분산 여부를 검사합니다.";
    status.style.cssText = "margin-bottom:8px;color:#475569";
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "미분산 상품 일괄 처리";
    button.style.cssText = "width:100%;padding:9px;border:0;border-radius:7px;background:#7c3aed;color:#fff;font-weight:700;cursor:pointer";
    const details = document.createElement("div");
    details.id = DETAILS_ID;
    box.append(title, status, button, details);
    document.documentElement.appendChild(box);
  }

  async function startChunk(run) {
    const chunk = run.goodsKeys.slice(run.nextIndex, run.nextIndex + CHUNK_SIZE);
    if (!chunk.length) return false;
    run.activeChunkSize = chunk.length;
    run.activeChunkStart = run.nextIndex;
    await saveRegistryRun(run);
    setButtonBusy(true, `OPS 원장 분산 ${run.completed}/${run.goodsKeys.length}`);
    setStatus(`OPS CENTER 등록 goods key ${run.goodsKeys.length}건 중 ${run.completed}건 완료 · 다음 ${chunk.length}건 검사 시작`, "info");
    const response = await sendRuntimeMessage({ type: BATCH_START_MESSAGE, goodsKeys: chunk });
    if (!response?.ok) {
      setButtonBusy(false, "미분산 상품 일괄 처리");
      setStatus(response?.message || "상품명 일괄 처리를 시작하지 못했습니다.", "error");
      await saveRegistryRun(null);
      return false;
    }
    return true;
  }

  async function runRegistryBatch() {
    const existing = await loadRegistryRun();
    if (existing?.status === "running") {
      setStatus("이미 OPS CENTER goods key 기준 상품명 분산이 진행 중입니다.", "error");
      return;
    }
    renderFailures([]);
    setButtonBusy(true, "OPS CENTER goods key 확인 중...");
    setStatus("Shopling 현재 검색결과를 사용하지 않고 OPS CENTER 등록 원장에서 goods key를 불러옵니다.", "info");

    const registry = await sendRuntimeMessage({ type: TITLE_REGISTRY_MESSAGE });
    if (!registry?.ok) {
      setButtonBusy(false, "미분산 상품 일괄 처리");
      setStatus(`OPS CENTER goods key 조회 실패: ${text(registry?.message) || "원인 미상"}`, "error");
      return;
    }
    const goodsKeys = [...new Set((Array.isArray(registry.goodsKeys) ? registry.goodsKeys : [])
      .map((value) => text(value))
      .filter((value) => /^\d{5,9}$/.test(value)))];
    if (!goodsKeys.length) {
      setButtonBusy(false, "미분산 상품 일괄 처리");
      setStatus("OPS CENTER에 Shopling 등록완료 goods key가 없습니다.", "success");
      return;
    }

    const run = {
      status: "running",
      goodsKeys,
      nextIndex: 0,
      completed: 0,
      changed: 0,
      autoRecovered: 0,
      skipped: 0,
      failed: 0,
      retryCount: 0,
      failures: [],
      activeChunkSize: 0,
      activeChunkStart: 0,
      startedAt: new Date().toISOString(),
    };
    await saveRegistryRun(run);
    await startChunk(run);
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest(`#${BUTTON_ID}`) : null;
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void runRegistryBatch();
  }, true);

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== BATCH_PROGRESS_MESSAGE) return;
    void (async () => {
      const run = await loadRegistryRun();
      if (!run || run.status !== "running") return;
      const chunkDone = Number(message.done || 0);
      const totalDone = Math.min(run.goodsKeys.length, run.completed + chunkDone);
      const changed = run.changed + Number(message.changed || 0);
      const skipped = run.skipped + Number(message.skipped || 0);
      const failed = run.failed + Number(message.failed || 0);
      const autoRecovered = run.autoRecovered + Number(message.autoRecovered || 0);

      if (message.status !== "completed") {
        setButtonBusy(true, `OPS 원장 분산 ${totalDone}/${run.goodsKeys.length}`);
        setStatus(`OPS 원장 진행 ${totalDone}/${run.goodsKeys.length} · 분산저장 ${changed} · 기존정상 ${skipped} · 확인필요 ${failed}${message.goodsKey ? ` · ${message.goodsKey}` : ""}`, "info");
        return;
      }

      run.completed += Number(message.done || run.activeChunkSize || 0);
      run.changed += Number(message.changed || 0);
      run.autoRecovered += Number(message.autoRecovered || 0);
      run.skipped += Number(message.skipped || 0);
      run.failed += Number(message.failed || 0);
      run.retryCount += Number(message.retryCount || 0);
      run.failures.push(...(Array.isArray(message.failures) ? message.failures : []));
      run.nextIndex = run.activeChunkStart + run.activeChunkSize;
      await saveRegistryRun(run);

      if (run.nextIndex < run.goodsKeys.length) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        await startChunk(run);
        return;
      }

      run.status = "completed";
      run.finishedAt = new Date().toISOString();
      setButtonBusy(false, "미분산 상품 일괄 처리");
      setStatus(
        `완료 · OPS 등록 ${run.completed}/${run.goodsKeys.length} · 분산저장 ${run.changed}${run.autoRecovered ? ` (자동복구 ${run.autoRecovered})` : ""} · 기존정상 ${run.skipped} · 최종확인 ${run.failed}`,
        run.failed ? "error" : "success",
      );
      renderFailures(run.failures);
      await saveRegistryRun(null);
    })();
  });

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    mountFallbackPanel();
    const status = document.getElementById(STATUS_ID);
    const button = document.getElementById(BUTTON_ID);
    if (status && button && !button.disabled) {
      status.textContent = "OPS CENTER에 등록된 goods key 기준 · 현재 조회조건/화면출력 수와 무관하게 미분산 여부를 검사합니다.";
    }
    if (document.getElementById(PANEL_ID) || attempts >= 30) clearInterval(timer);
  }, 400);
  mountFallbackPanel();
})();

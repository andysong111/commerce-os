(() => {
  "use strict";

  const PIPE_CLAIM_MESSAGE = "commerce-os-shopling-pipeline-claim";
  const PIPE_REPORT_MESSAGE = "commerce-os-shopling-pipeline-report";
  const TITLE_BATCH_START_MESSAGE = "commerce-os-shopling-title-batch-start";
  const TITLE_BATCH_PROGRESS_MESSAGE = "commerce-os-shopling-title-batch-progress";
  const PIPE_MARKET_PROGRESS_MESSAGE = "commerce-os-shopling-pipeline-market-progress";
  const PIPE_UI_RUN_KEY = "commerceOsShoplingPipelineUiRun";
  const PANEL_ID = "commerce-os-shopling-onebutton-panel";
  const STATUS_ID = `${PANEL_ID}-status`;
  const BUTTON_ID = `${PANEL_ID}-button`;
  const DETAILS_ID = `${PANEL_ID}-details`;
  const TOKEN_SESSION_KEY = "commerceOsShoplingPipelineToken";

  function text(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function bodyText() {
    return text(document.body?.innerText || document.body?.textContent || "");
  }

  function hasWorkerToken() {
    if (new URLSearchParams(location.search).get("commerce_os_pipeline_token")) return true;
    try {
      if (sessionStorage.getItem(TOKEN_SESSION_KEY)) return true;
    } catch {
      // Optional optimization only.
    }
    return /commerce-os-pipeline:[A-Za-z0-9._-]+/.test(text(window.name));
  }

  function hasSelfCodeSearchOption() {
    for (const select of document.querySelectorAll("select")) {
      const options = [...select.options].map((option) => text(option.textContent)).join(" ");
      if (/자사\s*상품\s*코드|자체\s*상품\s*코드|자사\s*코드/i.test(options)) return true;
    }
    return false;
  }

  function isProductListDocument() {
    if (location.hostname !== "a.shopling.co.kr") return false;
    if (location.pathname.startsWith("/prodlinkage/")) return false;
    const params = new URLSearchParams(location.search);
    if (params.has("prod_id") || params.get("popup") === "Y") return false;
    if (["modify", "nm_chg"].includes(text(params.get("mode")).toLowerCase())) return false;

    const content = bodyText();
    const hasResultCounter = /총\s*조회수\s*[:：]?\s*[\d,]+\s*건/.test(content);
    const hasListIdentity = /상품\s*조회\s*수정|상품조회수정|신규상품등록|상품일괄등록|상품대량수정/.test(content);
    return hasResultCounter && (hasListIdentity || hasSelfCodeSearchOption());
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
      const stored = await chrome.storage.session.get(PIPE_UI_RUN_KEY);
      return stored?.[PIPE_UI_RUN_KEY] || null;
    } catch {
      return null;
    }
  }

  async function saveUiRun(run) {
    try {
      if (!run) await chrome.storage.session.remove(PIPE_UI_RUN_KEY);
      else await chrome.storage.session.set({ [PIPE_UI_RUN_KEY]: run });
    } catch {
      // Durable server ledger remains authoritative.
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

  function renderDetails(tasks) {
    const host = document.getElementById(DETAILS_ID);
    if (!host) return;
    host.replaceChildren();
    const noteworthy = (Array.isArray(tasks) ? tasks : []).filter((task) =>
      ["failed", "confirm"].includes(task.status) || ["failed", "confirm"].includes(task.outcome),
    );
    if (!noteworthy.length) return;
    const details = document.createElement("details");
    details.style.cssText = "margin-top:7px;border-top:1px solid #fed7aa;padding-top:6px";
    const summary = document.createElement("summary");
    summary.textContent = `확인필요/실패 ${noteworthy.length}건 보기`;
    summary.style.cssText = "cursor:pointer;font-weight:700;color:#b91c1c";
    details.appendChild(summary);
    for (const task of noteworthy) {
      const row = document.createElement("div");
      row.style.cssText = "padding:4px 0;border-bottom:1px dotted #e2e8f0;font-size:11px";
      row.textContent = `${task.ptnGoodsCd || task.goodsKey || "상품"} · ${task.message || task.reasonCode || task.outcome}`;
      details.appendChild(row);
    }
    host.appendChild(details);
  }

  function newUiRunId() {
    return `pipeline-ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  async function startOneButtonPipeline() {
    const existing = await loadUiRun();
    if (existing?.status === "running") {
      setPanelStatus("이미 신규상품 자동처리가 진행 중입니다.", "error");
      return;
    }

    setPanelBusy(true, "OPS CENTER 신규등록 확인 중...");
    setPanelStatus("현재 Shopling 조회조건과 무관하게 OPS CENTER 신규등록 원장을 확인합니다.");

    const runId = newUiRunId();
    const claim = await sendRuntimeMessage({ type: PIPE_CLAIM_MESSAGE, runId });
    if (!claim?.ok) {
      setPanelBusy(false);
      setPanelStatus(`신규등록 원장 확인 실패: ${text(claim?.message || claim?.error)}`, "error");
      return;
    }

    const tasks = Array.isArray(claim.tasks) ? claim.tasks : [];
    if (!tasks.length) {
      setPanelBusy(false);
      setPanelStatus("신규 미처리 상품 0건 · 이전 처리상품은 자동 제외되었습니다.", "success");
      return;
    }

    const goodsKeys = [...new Set(tasks.map((task) => text(task.goodsKey)).filter((value) => /^\d{5,9}$/.test(value)))];
    const uiRun = {
      runId,
      status: "running",
      stage: "title",
      tasks,
      goodsKeys,
      launchItemCount: Number(claim.launchItemCount || 0),
      startedAt: new Date().toISOString(),
    };
    await saveUiRun(uiRun);

    setPanelStatus(`신규 ${uiRun.launchItemCount}개 상품군 · ${goodsKeys.length}개 채널 상품명 분산 시작`);
    setPanelBusy(true, `상품명 분산 0/${goodsKeys.length}`);
    const batch = await sendRuntimeMessage({ type: TITLE_BATCH_START_MESSAGE, goodsKeys });
    if (!batch?.ok) {
      await Promise.all(tasks.map((task) => sendRuntimeMessage({
        type: PIPE_REPORT_MESSAGE,
        runId,
        goodsKey: task.goodsKey,
        outcome: "title_failed",
        reasonCode: "title_batch_start_failed",
        message: text(batch?.message) || "상품명 일괄 분산을 시작하지 못했습니다.",
      })));
      setPanelBusy(false);
      setPanelStatus("상품명 분산 시작에 실패했습니다. claim 상품은 자동 재작업하지 않습니다.", "error");
      await saveUiRun(null);
    }
  }

  function mountPanel() {
    if (document.getElementById(PANEL_ID) || hasWorkerToken() || !isProductListDocument()) return;

    const box = document.createElement("div");
    box.id = PANEL_ID;
    box.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:390px",
      "z-index:2147483647",
      "width:390px",
      "padding:12px",
      "border:1px solid #fb923c",
      "border-radius:10px",
      "background:#fff",
      "box-shadow:0 8px 30px rgba(15,23,42,.16)",
      "font:12px/1.45 Arial,sans-serif",
      "color:#0f172a",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "Commerce OS · 신규상품 원버튼 처리";
    title.style.cssText = "font-weight:700;margin-bottom:5px";

    const mapping = document.createElement("div");
    mapping.textContent = "정확한 자사상품코드만 처리 · DM1→도매1 … SM2→소매2 · 동시 2창";
    mapping.style.cssText = "font-size:11px;color:#64748b;margin-bottom:7px";

    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.textContent = "상품을 미리 검색할 필요가 없습니다. 이전 처리상품은 원장에서 제외하고 신규등록만 처리합니다.";
    status.style.cssText = "margin-bottom:8px;color:#475569";

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "신규상품 전체 자동처리 · 동시 2창";
    button.style.cssText = "width:100%;padding:9px;border:0;border-radius:7px;background:#ea580c;color:#fff;font-weight:700;cursor:pointer";
    button.addEventListener("click", () => void startOneButtonPipeline());

    const guard = document.createElement("div");
    guard.textContent = "중복방지: Shopling 미등록 재확인 + 송신 직전 Commerce OS 영구 잠금";
    guard.style.cssText = "font-size:10px;color:#9a3412;margin-top:7px";

    const detailHost = document.createElement("div");
    detailHost.id = DETAILS_ID;

    box.append(title, mapping, status, button, guard, detailHost);
    document.documentElement.appendChild(box);

    void (async () => {
      const existing = await loadUiRun();
      if (existing?.status === "running") {
        setPanelBusy(true);
        setPanelStatus(`이전 실행 복구 중 · 단계 ${existing.stage || "확인"}`);
      }
    })();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object" || !document.getElementById(PANEL_ID)) return;

    if (message.type === TITLE_BATCH_PROGRESS_MESSAGE) {
      const total = Number(message.total || 0);
      const done = Number(message.done || 0);
      const failed = Number(message.failed || 0);
      if (message.status === "completed") {
        setPanelBusy(true, "마켓 자동전송 준비 중...");
        setPanelStatus(`상품명 분산 완료 ${done}/${total} · 실패 ${failed} · 신규상품 마켓 전송 준비`);
      } else {
        setPanelBusy(true, `상품명 분산 ${done}/${total}`);
        setPanelStatus(`신규상품 상품명 분산 진행 ${done}/${total} · 실패 ${failed}`);
      }
      return;
    }

    if (message.type === PIPE_MARKET_PROGRESS_MESSAGE) {
      const total = Number(message.total || 0);
      const done = Number(message.done || 0);
      const sent = Number(message.sent || 0);
      const already = Number(message.alreadyRegistered || 0);
      const failed = Number(message.failed || 0);
      const confirm = Number(message.confirmNeeded || 0);
      const active = Array.isArray(message.active) ? message.active : [];
      if (message.status === "completed") {
        setPanelBusy(false);
        setPanelStatus(
          `완료 · ${done}/${total} · 신규송신 ${sent} · 이미등록/미등록없음 ${already} · 확인필요 ${confirm} · 실패 ${failed}`,
          failed || confirm ? "error" : "success",
        );
        renderDetails(message.tasks || []);
      } else {
        const activeLabel = active.map((task) => `${task.ptnGoodsCd}→${task.profile}`).join(" / ");
        setPanelBusy(true, `마켓 전송 ${done}/${total}`);
        setPanelStatus(`마켓 진행 ${done}/${total} · 송신 ${sent} · 이미등록 ${already}${activeLabel ? ` · ${activeLabel}` : ""}`);
      }
    }
  });

  mountPanel();
  const observer = new MutationObserver(() => mountPanel());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

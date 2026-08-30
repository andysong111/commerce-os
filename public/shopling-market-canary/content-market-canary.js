(() => {
  "use strict";

  const CANARY_CLAIM_MESSAGE = "commerce-os-shopling-market-canary-claim";
  const PIPE_MARKET_START_MESSAGE = "commerce-os-shopling-pipeline-market-start";
  const PIPE_MARKET_PROGRESS_MESSAGE = "commerce-os-shopling-pipeline-market-progress";
  const PANEL_ID = "commerce-os-shopling-market-canary-panel";
  const STATUS_ID = `${PANEL_ID}-status`;
  const BUTTON_ID = `${PANEL_ID}-button`;
  const FULL_PANEL_ID = "commerce-os-shopling-onebutton-panel";

  function text(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function hasWorkerToken() {
    return Boolean(new URLSearchParams(location.search).get("commerce_os_pipeline_token"));
  }

  function isProductListUi() {
    if (location.hostname !== "a.shopling.co.kr" || hasWorkerToken()) return false;
    if (location.pathname.startsWith("/prodlinkage/")) return false;
    const params = new URLSearchParams(location.search);
    if (params.has("prod_id") || params.get("popup") === "Y") return false;
    const body = text(document.body?.innerText || document.body?.textContent || "");
    return /총\s*조회수\s*[:：]?\s*[\d,]+\s*건/.test(body)
      && /상품\s*조회\s*수정|상품조회수정|검색관리|EXCEL\s*저장/i.test(body);
  }

  function sendMessage(payload) {
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

  function newRunId() {
    return `canary-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function hideFullPanel() {
    const panel = document.getElementById(FULL_PANEL_ID);
    if (panel) panel.style.setProperty("display", "none", "important");
  }

  function setStatus(message, kind = "info") {
    const node = document.getElementById(STATUS_ID);
    if (!node) return;
    node.textContent = message;
    node.style.color = kind === "error" ? "#b91c1c" : kind === "success" ? "#166534" : "#475569";
  }

  function setBusy(busy, label = "") {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.disabled = Boolean(busy);
    button.style.opacity = busy ? "0.6" : "1";
    button.textContent = label || (busy ? "1건 실전테스트 진행 중..." : "마켓 전송 1건 실전테스트 · DM1→도매1");
  }

  async function startCanary() {
    setBusy(true, "DM1 테스트 대상 1건 확보 중...");
    setStatus("대량처리는 하지 않습니다. 대기 중인 DM1→도매1 한 건만 잠급니다.");

    const runId = newRunId();
    const claim = await sendMessage({ type: CANARY_CLAIM_MESSAGE, runId });
    if (!claim?.ok) {
      setBusy(false);
      setStatus(`Canary 대상 확보 실패: ${text(claim?.message || claim?.error)}`, "error");
      return;
    }
    const task = claim.task;
    if (!task) {
      setBusy(false);
      setStatus("테스트 가능한 신규 DM1→도매1 대기건이 없습니다.", "success");
      return;
    }
    if (text(task.searchCode) !== "DM1" || text(task.profile) !== "도매1") {
      setBusy(false);
      setStatus("안전검증 실패: DM1→도매1 이외 작업이 반환되어 송신하지 않았습니다.", "error");
      return;
    }

    setStatus(`테스트 대상 · ${text(task.ptnGoodsCd)} → 도매1 · 실제 Shopling 송신 경로를 검증합니다.`);
    const started = await sendMessage({
      type: PIPE_MARKET_START_MESSAGE,
      claimRunId: runId,
      tasks: [task],
    });
    if (!started?.ok) {
      setBusy(false);
      setStatus(`작업창 시작 실패: ${text(started?.message || started?.error)} · 실제 송신은 시작되지 않았습니다.`, "error");
      return;
    }
    setBusy(true, "실제 마켓 전송 테스트 0/1");
    setStatus(`${text(task.ptnGoodsCd)} → 도매1 실전 테스트 시작 · 작업창 1개가 자동으로 열립니다.`);
  }

  function mount() {
    hideFullPanel();
    if (!isProductListUi() || document.getElementById(PANEL_ID)) return;

    const box = document.createElement("div");
    box.id = PANEL_ID;
    box.style.cssText = [
      "position:fixed", "right:18px", "bottom:40px", "z-index:2147483647", "width:400px",
      "padding:12px", "border:2px solid #dc2626", "border-radius:10px", "background:#fff",
      "box-shadow:0 8px 30px rgba(15,23,42,.18)", "font:12px/1.45 Arial,sans-serif", "color:#0f172a",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "Commerce OS · 마켓 전송 1건 Canary";
    title.style.cssText = "font-weight:700;margin-bottom:5px;color:#991b1b";

    const guide = document.createElement("div");
    guide.textContent = "목적: 확장프로그램이 Shopling 상품 1건을 실제 도매1로 전송할 수 있는지만 검증";
    guide.style.cssText = "font-size:11px;color:#64748b;margin-bottom:7px";

    const status = document.createElement("div");
    status.id = STATUS_ID;
    status.textContent = "DM1→도매1 한 건만 테스트합니다. 다른 17건은 건드리지 않습니다.";
    status.style.cssText = "margin-bottom:8px;color:#475569";

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = "마켓 전송 1건 실전테스트 · DM1→도매1";
    button.style.cssText = "width:100%;padding:10px;border:0;border-radius:7px;background:#dc2626;color:#fff;font-weight:700;cursor:pointer";
    button.addEventListener("click", () => void startCanary());

    const guard = document.createElement("div");
    guard.textContent = "exact 자사상품코드 · Shopling 미등록 재확인 · 송신 직전 영구잠금 · 송신 전 실패는 자동 원복";
    guard.style.cssText = "font-size:10px;color:#7f1d1d;margin-top:7px";

    box.append(title, guide, status, button, guard);
    document.documentElement.appendChild(box);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.type !== PIPE_MARKET_PROGRESS_MESSAGE || !document.getElementById(PANEL_ID)) return;
    const total = Number(message.total || 0);
    if (total !== 1) return;
    const done = Number(message.done || 0);
    const sent = Number(message.sent || 0);
    const already = Number(message.alreadyRegistered || 0);
    const failed = Number(message.failed || 0);
    const confirm = Number(message.confirmNeeded || 0);
    const active = Array.isArray(message.active) ? message.active : [];

    if (message.status === "completed") {
      setBusy(false);
      if (sent === 1) {
        setStatus("Canary 성공 · 확장프로그램 기반 Shopling→도매1 실제 송신이 확인됐습니다.", "success");
      } else if (already === 1) {
        setStatus("Canary 안전종료 · 이미 등록/미등록없음으로 확인되어 재송신하지 않았습니다.", "success");
      } else if (confirm === 1) {
        setStatus("Canary 확인필요 · 송신 경계 이후 결과가 불명확해 자동 재전송을 차단했습니다.", "error");
      } else {
        setStatus(`Canary 실패 · ${done}/1 · 송신 ${sent} · 실패 ${failed} · 송신 전 실패는 자동 재대기됩니다.`, "error");
      }
      return;
    }

    const stage = text(active[0]?.stage || "진행중");
    const code = text(active[0]?.ptnGoodsCd || "DM1");
    setBusy(true, "실제 마켓 전송 테스트 0/1");
    setStatus(`${code} → 도매1 · 현재 단계: ${stage}`);
  });

  mount();
  const observer = new MutationObserver(() => mount());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

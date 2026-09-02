const planCard = document.getElementById("planCard");
const runState = document.getElementById("runState");
const jobs = document.getElementById("jobs");
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const refreshButton = document.getElementById("refresh");
const diagnoseButton = document.getElementById("diagnose");
const copyDiagnosticButton = document.getElementById("copyDiagnostic");
const diagnosticBox = document.getElementById("diagnostic");
const DIAGNOSTIC_ONLY = true;
let plan = null;
let sourceTabId = null;
let lastDiagnostic = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" }[char]));
}

async function activeShoplingTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url?.startsWith("https://a.shopling.co.kr/")) {
    throw new Error("Shopling 로그인 탭에서 확장프로그램을 열어주세요. A18 빈 화면에서도 진단할 수 있습니다.");
  }
  return tab;
}

async function loadPlan() {
  try {
    const tab = await activeShoplingTab();
    sourceTabId = tab.id;
    const response = await chrome.runtime.sendMessage({ type: "A21_GET_PLAN" });
    if (!response?.ok) throw new Error(response?.error || "대상 조회 실패");
    plan = response.plan;
    planCard.innerHTML = `<div class="grid"><div class="metric">GOODSKEY<b>${plan.goodsKeyCount}</b></div><div class="metric">검증 쇼핑몰가격<b>${plan.readback.mallMatchCount}/${plan.readback.mallCheckCount}</b></div></div><p class="ok" style="margin-top:8px;font-weight:700">Shopling 가격 재조회 VERIFIED · 불일치 ${plan.readback.mallMismatchCount} · 누락 ${plan.readback.mallMissingCount}</p><p style="margin-top:5px">현재 버전은 송신하지 않고 열린 상품수정 송신 팝업의 실제 form 구조만 읽습니다.</p>`;
  } catch (error) {
    planCard.innerHTML = `<span class="bad"><b>대상 확인 실패</b><br>${escapeHtml(error.message || error)}</span>`;
  }
  startButton.disabled = true;
}

function renderState(state) {
  if (!state || state.state === "IDLE") {
    runState.innerHTML = "실행 대기";
    jobs.innerHTML = "";
    stopButton.style.display = "none";
    return;
  }
  const success = state.jobs.filter((job) => job.status === "SUCCEEDED").length;
  const failed = state.jobs.filter((job) => job.status === "FAILED").length;
  const running = state.jobs.filter((job) => job.status === "RUNNING").length;
  const queued = state.jobs.filter((job) => job.status === "QUEUED").length;
  const cls = state.state === "SUCCEEDED" ? "ok" : state.state === "PARTIAL_FAILURE" ? "bad" : "warn";
  runState.innerHTML = `<b class="${cls}">${escapeHtml(state.state)}</b> · 배치 ${state.batchCount} · 성공 ${success} · 실행 ${running} · 대기 ${queued} · 실패 ${failed}`;
  jobs.innerHTML = state.jobs.filter((job) => job.status !== "SUPERSEDED").map((job) => `<div class="job"><strong>배치 ${job.batchIndex} · ${job.mode === "PRICE" ? "판매가" : "옵션"} · ${job.goodsKeyCount} GOODSKEY</strong> <span class="pill ${job.status}">${job.status}</span><small>${escapeHtml(job.message || job.stage || "")}${job.error ? ` · ${escapeHtml(job.error)}` : ""}</small></div>`).join("");
  stopButton.style.display = state.state === "RUNNING" ? "block" : "none";
  startButton.disabled = true;
}

async function refreshState() {
  const response = await chrome.runtime.sendMessage({ type: "A21_GET_STATE" });
  if (response?.ok) renderState(response.state);
}

function diagnosticProbe() {
  const norm = (v) => String(v ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  const text = norm(document.body?.innerText || document.body?.textContent || "");
  const isPopup = /상품수정\s*송신/i.test(text) && /일반내용수정/i.test(text) && /옵션송신/i.test(text);
  if (!isPopup) return null;
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const nearby = (el) => {
    const parts = [];
    for (const node of [el.parentElement, el.parentElement?.parentElement, el.closest?.("td"), el.closest?.("tr")]) {
      const t = norm(node?.textContent || "");
      if (t && !parts.includes(t)) parts.push(t.slice(0, 180));
    }
    return parts.slice(0, 4);
  };
  const inputs = [...document.querySelectorAll("input")].map((el, index) => ({
    index,
    type: el.type,
    name: el.name || "",
    id: el.id || "",
    value: el.value || "",
    checked: Boolean(el.checked),
    disabled: Boolean(el.disabled),
    alt: el.alt || "",
    title: el.title || "",
    onclick: el.getAttribute("onclick") || "",
    rect: rect(el),
    nearby: nearby(el),
  }));
  const clickableSelector = "button,a,input[type=button],input[type=submit],input[type=image],[onclick],img";
  const clickables = [...document.querySelectorAll(clickableSelector)].map((el, index) => ({
    index,
    tag: el.tagName,
    type: el instanceof HTMLInputElement ? el.type : "",
    name: el instanceof HTMLInputElement ? el.name || "" : "",
    id: el.id || "",
    value: el instanceof HTMLInputElement ? el.value || "" : "",
    text: norm(el.textContent || "").slice(0, 120),
    alt: el.getAttribute("alt") || "",
    title: el.getAttribute("title") || "",
    href: el.getAttribute("href") || "",
    onclick: el.getAttribute("onclick") || "",
    rect: rect(el),
  })).filter((item) => /송신|수정|선택/.test(`${item.value} ${item.text} ${item.alt} ${item.title} ${item.onclick}`));
  const forms = [...document.forms].map((form, index) => ({
    index,
    name: form.name || "",
    id: form.id || "",
    action: form.action || "",
    method: form.method || "",
    target: form.target || "",
    inputCount: form.querySelectorAll("input").length,
  }));
  return {
    href: location.href,
    title: document.title,
    textHead: text.slice(0, 500),
    forms,
    radios: inputs.filter((item) => item.type === "radio"),
    checkboxes: inputs.filter((item) => item.type === "checkbox"),
    submitCandidates: clickables,
  };
}

async function collectDiagnostic() {
  diagnoseButton.disabled = true;
  diagnosticBox.textContent = "열린 Shopling 상품수정 송신 팝업 탐색 중...";
  copyDiagnosticButton.disabled = true;
  try {
    const tabs = await chrome.tabs.query({ url: "https://a.shopling.co.kr/*" });
    const found = [];
    for (const tab of tabs) {
      if (!Number.isInteger(tab.id)) continue;
      let frames = [];
      try {
        frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: diagnosticProbe });
      } catch (error) {
        found.push({ tabId: tab.id, url: tab.url || "", error: String(error?.message || error) });
        continue;
      }
      for (const frame of frames) {
        if (!frame?.result) continue;
        found.push({ tabId: tab.id, windowId: tab.windowId, frameId: frame.frameId, tabUrl: tab.url || "", ...frame.result });
      }
    }
    const popupFrames = found.filter((item) => Array.isArray(item.radios));
    if (!popupFrames.length) {
      lastDiagnostic = { scannedTabs: tabs.length, popupFrames: [], errors: found.filter((item) => item.error) };
      diagnosticBox.textContent = "상품수정 송신 팝업 DOM을 찾지 못했습니다. 화면에 해당 팝업을 열어둔 상태에서 다시 눌러주세요.";
      return;
    }
    lastDiagnostic = { capturedAt: new Date().toISOString(), scannedTabs: tabs.length, popupFrames };
    const summary = popupFrames.map((frame, idx) => {
      const radios = frame.radios.map((r) => `#${r.index} name=${r.name || "-"} value=${r.value || "-"} checked=${r.checked} x=${r.rect.x} y=${r.rect.y} nearby=${(r.nearby || []).join(" / ").slice(0, 120)}`).join("\n");
      const buttons = frame.submitCandidates.map((b) => `${b.tag} type=${b.type || "-"} name=${b.name || "-"} value=${b.value || "-"} text=${b.text || "-"} onclick=${b.onclick || "-"} x=${b.rect.x} y=${b.rect.y}`).join("\n");
      return `[POPUP ${idx + 1}] ${frame.href}\nFORMS ${JSON.stringify(frame.forms)}\nRADIOS\n${radios}\nSUBMIT CANDIDATES\n${buttons}`;
    }).join("\n\n");
    diagnosticBox.textContent = summary;
    copyDiagnosticButton.disabled = false;
  } catch (error) {
    diagnosticBox.textContent = `진단 실패: ${error?.message || error}`;
  } finally {
    diagnoseButton.disabled = false;
  }
}

diagnoseButton.addEventListener("click", collectDiagnostic);
copyDiagnosticButton.addEventListener("click", async () => {
  if (!lastDiagnostic) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(lastDiagnostic, null, 2));
    copyDiagnosticButton.textContent = "복사 완료";
    setTimeout(() => { copyDiagnosticButton.textContent = "진단 JSON 복사"; }, 1200);
  } catch (error) {
    diagnosticBox.textContent += `\n\n복사 실패: ${error?.message || error}`;
  }
});

startButton.addEventListener("click", () => {
  if (DIAGNOSTIC_ONLY) runState.innerHTML = '<span class="warn">v0.1.7은 진단 전용이라 자동전송이 잠겨 있습니다.</span>';
});

stopButton.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "A21_STOP" });
  if (response?.ok) renderState(response.state);
});

refreshButton.addEventListener("click", async () => {
  await loadPlan();
  await refreshState();
});

setInterval(refreshState, 1500);
void loadPlan().then(refreshState);

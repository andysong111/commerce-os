const planCard = document.getElementById("planCard");
const runState = document.getElementById("runState");
const jobs = document.getElementById("jobs");
const testButton = document.getElementById("test");
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const refreshButton = document.getElementById("refresh");
let plan = null;
let refreshBusy = false;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" }[char]));
}

async function activeShoplingTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url?.startsWith("https://a.shopling.co.kr/")) {
    throw new Error("Shopling 로그인 탭에서 확장프로그램을 열어주세요. A18 빈 화면에서도 실행할 수 있습니다.");
  }
  return tab;
}

function setRunButtons(enabled) {
  testButton.disabled = !enabled;
  startButton.disabled = !enabled;
}

async function loadPlan() {
  try {
    await activeShoplingTab();
    const response = await chrome.runtime.sendMessage({ type: "A21_GET_PLAN" });
    if (!response?.ok) throw new Error(response?.error || "대상 조회 실패");
    plan = response.plan;
    const verified = plan.readback?.state === "VERIFIED"
      && Number(plan.readback?.mallMismatchCount || 0) === 0
      && Number(plan.readback?.mallMissingCount || 0) === 0
      && Number(plan.readback?.mallMatchCount || 0) === Number(plan.readback?.mallCheckCount || 0);
    if (!verified) throw new Error("Shopling 쇼핑몰별 판매가 재조회가 100% 일치 상태가 아닙니다.");
    planCard.innerHTML = `<div class="grid"><div class="metric">GOODSKEY<b>${plan.goodsKeyCount}</b></div><div class="metric">검증 쇼핑몰가격<b>${plan.readback.mallMatchCount}/${plan.readback.mallCheckCount}</b></div></div><p class="ok" style="margin-top:8px;font-weight:700">Shopling 가격 재조회 VERIFIED · 불일치 ${plan.readback.mallMismatchCount} · 누락 ${plan.readback.mallMissingCount}</p><p style="margin-top:5px">v0.4.1은 결과창 content-script나 A21 최종전송일을 완료판정에 사용하지 않습니다. Chrome debugger(CDP)가 실행 중 생성된 실제 결과창과 모든 실행 컨텍스트에 직접 연결해 DOM을 읽고 자동으로 스크롤합니다. 실제 결과문서에서 ‘처리중입니다/잠시만 기다려주시기 바랍니다’가 사라지고 결과표 또는 완료 footer가 안정된 뒤에만 기존 v0.2.7의 completeJob → 다음 큐 구조로 옵션전송을 시작합니다. 마켓별 성공/실패는 진행 조건으로 사용하지 않습니다. 실행 중 Chrome에 디버깅 안내가 표시될 수 있으며 작업이 끝나면 자동 해제됩니다.</p>`;
    setRunButtons(true);
  } catch (error) {
    planCard.innerHTML = `<span class="bad"><b>시작 차단</b><br>${escapeHtml(error.message || error)}</span>`;
    setRunButtons(false);
  }
}

function renderState(state) {
  if (!state || state.state === "IDLE") {
    runState.innerHTML = "실행 대기";
    jobs.innerHTML = "";
    stopButton.style.display = "none";
    setRunButtons(Boolean(plan));
    return;
  }
  const rows = Array.isArray(state.jobs) ? state.jobs : [];
  const success = rows.filter((job) => job.status === "SUCCEEDED").length;
  const failed = rows.filter((job) => job.status === "FAILED").length;
  const running = rows.filter((job) => job.status === "RUNNING").length;
  const queued = rows.filter((job) => job.status === "QUEUED").length;
  const cls = state.state === "SUCCEEDED" ? "ok" : ["PARTIAL_FAILURE", "STOPPED"].includes(state.state) ? "bad" : "warn";
  const modeLabel = state.testMode ? "1 GOODSKEY TEST" : "FULL";
  runState.innerHTML = `<b class="${cls}">${escapeHtml(state.state)}</b> · ${modeLabel} · 배치 ${state.batchCount || 0} · 성공 ${success} · 실행 ${running} · 대기 ${queued} · 실패 ${failed}`;
  jobs.innerHTML = rows.filter((job) => job.status !== "SUPERSEDED").map((job) => `<div class="job"><strong>배치 ${job.batchIndex} · ${job.mode === "PRICE" ? "판매가" : "옵션"} · ${job.goodsKeyCount} GOODSKEY</strong> <span class="pill ${job.status}">${job.status}</span><small>${escapeHtml(job.message || job.stage || "")}${job.error ? ` · ${escapeHtml(job.error)}` : ""}</small></div>`).join("");
  stopButton.style.display = state.state === "RUNNING" ? "block" : "none";
  setRunButtons(state.state !== "RUNNING" && Boolean(plan));
}

async function refreshState() {
  if (refreshBusy) return;
  refreshBusy = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: "A21_GET_STATE" });
    if (response?.ok) renderState(response.state);
  } finally {
    refreshBusy = false;
  }
}

async function startRun(testMode) {
  setRunButtons(false);
  try {
    const tab = await activeShoplingTab();
    const response = await chrome.runtime.sendMessage({ type: "A21_START", sourceTabId: tab.id, testMode });
    if (!response?.ok) throw new Error(response?.error || "실행 시작 실패");
    renderState(response.state);
  } catch (error) {
    runState.innerHTML = `<span class="bad">${escapeHtml(error.message || error)}</span>`;
    setRunButtons(true);
  }
}

testButton.addEventListener("click", () => void startRun(true));
startButton.addEventListener("click", () => void startRun(false));

stopButton.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "A21_STOP" });
  if (response?.ok) renderState(response.state);
});

refreshButton.addEventListener("click", async () => {
  await loadPlan();
  await refreshState();
});

setInterval(() => void refreshState(), 1000);
void loadPlan().then(refreshState);

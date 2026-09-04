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
    planCard.innerHTML = `<div class="grid"><div class="metric">GOODSKEY<b>${plan.goodsKeyCount}</b></div><div class="metric">검증 쇼핑몰가격<b>${plan.readback.mallMatchCount}/${plan.readback.mallCheckCount}</b></div></div><p class="ok" style="margin-top:8px;font-weight:700">Shopling 가격 재조회 VERIFIED · 불일치 ${plan.readback.mallMismatchCount} · 누락 ${plan.readback.mallMissingCount}</p><p style="margin-top:5px">v0.4.4는 대량 배치에서 화면에는 최종 완료 footer가 보이는데 v0.4.3이 top document에서만 찾다가 V043_DEFINITIVE_COMPLETION_TIMEOUT으로 빠질 수 있던 문제를 보완합니다. 결과창의 top document뿐 아니라 모든 Runtime frame context와 Chrome Accessibility 트리를 함께 읽습니다. 판매가는 ‘상품 수정 전송이 완료되었습니다.’, 옵션은 ‘상품옵션 수정 전송이 완료되었습니다.’를 각각 찾고, 처리중 문구가 없고 document complete까지 확인된 상태가 2.5초 유지된 뒤에만 다음 큐로 넘어갑니다. 마켓별 성공/실패는 진행 조건으로 사용하지 않습니다. 실행 중 Chrome에 디버깅 안내가 표시될 수 있으며 작업이 끝나면 자동 해제됩니다.</p>`;
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

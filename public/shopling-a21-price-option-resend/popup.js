const planCard = document.getElementById("planCard");
const runState = document.getElementById("runState");
const jobs = document.getElementById("jobs");
const startButton = document.getElementById("start");
const stopButton = document.getElementById("stop");
const refreshButton = document.getElementById("refresh");
let plan = null;
let sourceTabId = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

async function activeA21Tab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id || !tab.url?.startsWith("https://a.shopling.co.kr/")) throw new Error("샵플링 A21 탭에서 확장프로그램을 열어주세요.");
  const result = await chrome.tabs.sendMessage(tab.id, { type: "A21_IDENTIFY" });
  if (!result?.ok || result.role !== "A21_LIST") throw new Error("현재 탭은 A21 쇼핑몰상품수정 목록 화면이 아닙니다.");
  return tab;
}

async function loadPlan() {
  try {
    const tab = await activeA21Tab();
    sourceTabId = tab.id;
    const response = await chrome.runtime.sendMessage({ type: "A21_GET_PLAN" });
    if (!response?.ok) throw new Error(response?.error || "대상 조회 실패");
    plan = response.plan;
    planCard.innerHTML = `<div class="grid"><div class="metric">GOODSKEY<b>${plan.goodsKeyCount}</b></div><div class="metric">검증 쇼핑몰가격<b>${plan.readback.mallMatchCount}/${plan.readback.mallCheckCount}</b></div></div><p class="ok" style="margin-top:8px;font-weight:700">Shopling 가격 재조회 VERIFIED · 불일치 ${plan.readback.mallMismatchCount} · 누락 ${plan.readback.mallMissingCount}</p><p style="margin-top:5px">최대 200개 코드씩 시작하고, 조회결과가 500행을 넘으면 전송 전에 자동으로 더 작은 묶음으로 분할합니다.</p>`;
    startButton.disabled = false;
  } catch (error) {
    planCard.innerHTML = `<span class="bad"><b>시작 차단</b><br>${escapeHtml(error.message || error)}</span>`;
    startButton.disabled = true;
  }
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
  startButton.disabled = state.state === "RUNNING";
}

async function refreshState() {
  const response = await chrome.runtime.sendMessage({ type: "A21_GET_STATE" });
  if (response?.ok) renderState(response.state);
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  try {
    const tab = await activeA21Tab();
    sourceTabId = tab.id;
    const response = await chrome.runtime.sendMessage({ type: "A21_START", sourceTabId });
    if (!response?.ok) throw new Error(response?.error || "실행 시작 실패");
    renderState(response.state);
  } catch (error) {
    runState.innerHTML = `<span class="bad">${escapeHtml(error.message || error)}</span>`;
    startButton.disabled = false;
  }
});

stopButton.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "A21_STOP" });
  if (response?.ok) renderState(response.state);
});

refreshButton.addEventListener("click", refreshState);
setInterval(refreshState, 1500);
void loadPlan().then(refreshState);

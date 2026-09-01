const VERSION = "0.1.0";
const PLAN_URL = "https://commerce-os-ops-center.vercel.app/api/shopling-a21-price-option-resend/plan";
const STATE_KEY = "commerceOsShoplingA21PriceOptionResendV010";
const MAX_CONCURRENT = 4;
const MAX_SEARCH_CODES = 200;
const MODES = ["PRICE", "OPTION"];

const now = () => Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const uid = (prefix = "id") => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

async function loadState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  return stored[STATE_KEY] || null;
}

async function saveState(state) {
  state.updatedAt = now();
  await chrome.storage.local.set({ [STATE_KEY]: state });
  return state;
}

function publicState(state) {
  if (!state) return { version: VERSION, state: "IDLE", jobs: [] };
  return {
    version: VERSION,
    runId: state.runId,
    state: state.state,
    fingerprint: state.fingerprint,
    goodsKeyCount: state.goodsKeyCount,
    mallCheckCount: state.mallCheckCount,
    batchCount: state.batches?.length || 0,
    jobs: (state.jobs || []).map((job) => ({
      id: job.id,
      batchId: job.batchId,
      batchIndex: job.batchIndex,
      mode: job.mode,
      goodsKeyCount: job.goodsKeys.length,
      status: job.status,
      stage: job.stage,
      selectedRowCount: job.selectedRowCount || 0,
      totalResultCount: job.totalResultCount || 0,
      message: job.message || "",
      error: job.error || "",
    })),
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
  };
}

async function fetchPlan() {
  const response = await fetch(PLAN_URL, { cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new Error(body?.message || body?.error || `Commerce OS plan fetch failed (${response.status})`);
  }
  if (body.readback?.state !== "VERIFIED") {
    throw new Error("Shopling 가격 재조회 검증이 VERIFIED가 아니어서 마켓 수정전송을 차단했습니다.");
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    throw new Error("수정전송 대상 GOODSKEY가 없습니다.");
  }
  return body;
}

function buildInitialBatches(rows) {
  const batches = [];
  for (let i = 0; i < rows.length; i += MAX_SEARCH_CODES) {
    batches.push({ id: uid("batch"), goodsKeys: rows.slice(i, i + MAX_SEARCH_CODES).map((row) => String(row.goodsKey)) });
  }
  return batches;
}

function rebuildBatchIndexes(state) {
  state.batches.forEach((batch, index) => { batch.index = index + 1; });
  for (const job of state.jobs) {
    const batch = state.batches.find((item) => item.id === job.batchId);
    if (batch) job.batchIndex = batch.index;
  }
}

function addBatchJobs(state, batch) {
  for (const mode of MODES) {
    state.jobs.push({
      id: uid(`job-${mode.toLowerCase()}`),
      batchId: batch.id,
      batchIndex: batch.index,
      mode,
      goodsKeys: [...batch.goodsKeys],
      status: "QUEUED",
      stage: "OPENING",
      workerWindowId: null,
      workerTabId: null,
      popupWindowId: null,
      popupTabId: null,
      selectedRowCount: 0,
      totalResultCount: 0,
      createdAt: now(),
      updatedAt: now(),
      message: "대기 중",
      error: "",
    });
  }
}

async function validateSourceTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab?.url?.startsWith("https://a.shopling.co.kr/")) {
    throw new Error("샵플링 A21 화면에서 확장프로그램을 실행해주세요.");
  }
  const response = await sendWithRetry(tabId, { type: "A21_IDENTIFY" }, 20, 250);
  if (!response?.ok || response.role !== "A21_LIST") {
    throw new Error("현재 탭이 샵플링 A21 쇼핑몰상품수정 목록 화면이 아닙니다.");
  }
  return tab;
}

async function startRun(sourceTabId) {
  const sourceTab = await validateSourceTab(sourceTabId);
  const plan = await fetchPlan();
  const batches = buildInitialBatches(plan.rows);
  const state = {
    version: VERSION,
    runId: uid("run"),
    state: "RUNNING",
    fingerprint: plan.proposalFingerprint,
    goodsKeyCount: plan.goodsKeyCount,
    mallCheckCount: plan.readback?.mallCheckCount || 0,
    sourceUrl: sourceTab.url,
    batches,
    jobs: [],
    stopped: false,
    startedAt: now(),
    updatedAt: now(),
  };
  rebuildBatchIndexes(state);
  for (const batch of batches) addBatchJobs(state, batch);
  await saveState(state);
  await pump();
  return publicState(await loadState());
}

async function sendWithRetry(tabId, message, attempts = 30, delay = 300) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      await sleep(delay);
    }
  }
  throw lastError || new Error("content script unavailable");
}

async function launchJob(state, job) {
  const created = await chrome.windows.create({
    url: state.sourceUrl,
    type: "popup",
    width: 1420,
    height: 900,
    focused: false,
  });
  const tab = created.tabs?.[0];
  if (!tab?.id) throw new Error("A21 작업 탭을 만들지 못했습니다.");
  job.workerWindowId = created.id;
  job.workerTabId = tab.id;
  job.status = "RUNNING";
  job.stage = "SEARCH_CONFIG";
  job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 작업창 준비 중`;
  job.updatedAt = now();
  await saveState(state);
  void assignWorkerTab(tab.id);
}

async function assignWorkerTab(tabId) {
  const state = await loadState();
  if (!state || state.state !== "RUNNING" || state.stopped) return;
  const job = state.jobs.find((item) => item.workerTabId === tabId && item.status === "RUNNING");
  if (!job) return;
  try {
    await sendWithRetry(tabId, {
      type: "A21_LIST_ASSIGNMENT",
      runId: state.runId,
      jobId: job.id,
      mode: job.mode,
      goodsKeys: job.goodsKeys,
      stage: job.stage,
    });
  } catch (error) {
    await failJob(job.id, "WORKER_CONTENT_UNAVAILABLE", error instanceof Error ? error.message : String(error));
  }
}

async function assignPopupTab(tabId, openerTabId) {
  const state = await loadState();
  if (!state || state.state !== "RUNNING" || state.stopped) return;
  const job = state.jobs.find((item) => item.workerTabId === openerTabId && item.status === "RUNNING");
  if (!job) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    job.popupTabId = tabId;
    job.popupWindowId = tab.windowId;
    const waitingForResult = ["SUBMIT_CLICKED", "RESULT_WAIT"].includes(job.stage);
    if (!waitingForResult) {
      if (job.stage === "POPUP_CONFIG" && job.popupAssignedAt && now() - job.popupAssignedAt < 2500) return;
      job.stage = "POPUP_CONFIG";
      job.popupAssignedAt = now();
      job.message = `${job.mode === "PRICE" ? "판매가" : "옵션"} 전송 팝업 설정 중`;
    }
    job.updatedAt = now();
    await saveState(state);
    await sendWithRetry(tabId, {
      type: waitingForResult ? "A21_POPUP_RESULT_ASSIGNMENT" : "A21_POPUP_ASSIGNMENT",
      runId: state.runId,
      jobId: job.id,
      mode: job.mode,
    });
  } catch (error) {
    await failJob(job.id, "POPUP_CONTENT_UNAVAILABLE", error instanceof Error ? error.message : String(error));
  }
}

async function closeJobWindows(job) {
  const ids = [...new Set([job.popupWindowId, job.workerWindowId].filter(Number.isInteger))];
  for (const windowId of ids) {
    try { await chrome.windows.remove(windowId); } catch { /* already closed */ }
  }
}

async function completeJob(jobId, payload = {}) {
  const state = await loadState();
  if (!state) return;
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job || !["RUNNING", "QUEUED"].includes(job.status)) return;
  job.status = "SUCCEEDED";
  job.stage = "DONE";
  job.selectedRowCount = Number(payload.selectedRowCount || job.selectedRowCount || 0);
  job.totalResultCount = Number(payload.totalResultCount || job.totalResultCount || 0);
  job.message = payload.message || "샵플링 수정전송 성공 확인";
  job.error = "";
  job.updatedAt = now();
  await saveState(state);
  await closeJobWindows(job);
  await finalizeOrPump();
}

async function failJob(jobId, code, message) {
  const state = await loadState();
  if (!state) return;
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job || ["SUCCEEDED", "FAILED", "SUPERSEDED"].includes(job.status)) return;
  job.status = "FAILED";
  job.stage = "FAILED";
  job.error = code || "A21_JOB_FAILED";
  job.message = message || "작업 실패";
  job.updatedAt = now();
  await saveState(state);
  await closeJobWindows(job);
  await finalizeOrPump();
}

async function splitBatch(jobId, totalResultCount) {
  const state = await loadState();
  if (!state || state.state !== "RUNNING") return;
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) return;
  const batch = state.batches.find((item) => item.id === job.batchId);
  if (!batch || batch.goodsKeys.length <= 1) {
    await failJob(jobId, "A21_RESULT_TOO_LARGE_SINGLE_CODE", `한 GOODSKEY 결과가 ${totalResultCount}건이라 자동 분할할 수 없습니다.`);
    return;
  }
  if (batch.splitHandled) return;
  batch.splitHandled = true;
  const related = state.jobs.filter((item) => item.batchId === batch.id && ["QUEUED", "RUNNING"].includes(item.status));
  for (const item of related) {
    item.status = "SUPERSEDED";
    item.stage = "SPLIT";
    item.message = `결과 ${totalResultCount}건 > 500건, 더 작은 묶음으로 자동 분할`;
    item.updatedAt = now();
    await closeJobWindows(item);
  }
  const middle = Math.ceil(batch.goodsKeys.length / 2);
  const left = { id: uid("batch"), goodsKeys: batch.goodsKeys.slice(0, middle) };
  const right = { id: uid("batch"), goodsKeys: batch.goodsKeys.slice(middle) };
  const at = state.batches.findIndex((item) => item.id === batch.id);
  state.batches.splice(at, 1, left, right);
  rebuildBatchIndexes(state);
  addBatchJobs(state, left);
  addBatchJobs(state, right);
  rebuildBatchIndexes(state);
  await saveState(state);
  await pump();
}

async function finalizeOrPump() {
  const state = await loadState();
  if (!state) return;
  const active = state.jobs.filter((job) => job.status === "RUNNING").length;
  const queued = state.jobs.filter((job) => job.status === "QUEUED").length;
  if (!active && !queued) {
    const failed = state.jobs.filter((job) => job.status === "FAILED").length;
    state.state = failed ? "PARTIAL_FAILURE" : "SUCCEEDED";
    await saveState(state);
    return;
  }
  await pump();
}

async function pump() {
  const state = await loadState();
  if (!state || state.state !== "RUNNING" || state.stopped) return;
  let active = state.jobs.filter((job) => job.status === "RUNNING").length;
  const queued = state.jobs.filter((job) => job.status === "QUEUED");
  for (const job of queued) {
    if (active >= MAX_CONCURRENT) break;
    try {
      await launchJob(state, job);
      active += 1;
    } catch (error) {
      job.status = "FAILED";
      job.stage = "FAILED";
      job.error = "A21_WINDOW_CREATE_FAILED";
      job.message = error instanceof Error ? error.message : String(error);
      job.updatedAt = now();
      await saveState(state);
    }
  }
}

async function stopRun() {
  const state = await loadState();
  if (!state) return publicState(state);
  state.stopped = true;
  state.state = "STOPPED";
  for (const job of state.jobs) {
    if (["QUEUED", "RUNNING"].includes(job.status)) {
      job.status = "STOPPED";
      job.stage = "STOPPED";
      job.message = "사용자 중지";
      await closeJobWindows(job);
    }
  }
  await saveState(state);
  return publicState(state);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  void (async () => {
    const state = await loadState();
    if (!state || state.state !== "RUNNING") return;
    if (state.jobs.some((job) => job.workerTabId === tabId && job.status === "RUNNING")) {
      await assignWorkerTab(tabId);
      return;
    }
    if (tab.openerTabId && state.jobs.some((job) => job.workerTabId === tab.openerTabId && job.status === "RUNNING")) {
      await assignPopupTab(tabId, tab.openerTabId);
    }
  })();
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab.id || !tab.openerTabId) return;
  void assignPopupTab(tab.id, tab.openerTabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const state = await loadState();
    if (!state || state.state !== "RUNNING") return;
    const job = state.jobs.find((item) => item.status === "RUNNING" && (item.workerTabId === tabId || item.popupTabId === tabId));
    if (!job) return;
    if (["SUBMIT_CLICKED", "RESULT_WAIT"].includes(job.stage)) {
      await failJob(job.id, "A21_RESULT_WINDOW_CLOSED_UNVERIFIED", "전송 후 결과 확인 전에 창이 닫혀 성공으로 처리하지 않았습니다.");
    }
  })();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void (async () => {
    try {
      if (message?.type === "A21_GET_PLAN") {
        const plan = await fetchPlan();
        sendResponse({ ok: true, plan });
        return;
      }
      if (message?.type === "A21_GET_STATE") {
        sendResponse({ ok: true, state: publicState(await loadState()) });
        return;
      }
      if (message?.type === "A21_START") {
        sendResponse({ ok: true, state: await startRun(Number(message.sourceTabId)) });
        return;
      }
      if (message?.type === "A21_STOP") {
        sendResponse({ ok: true, state: await stopRun() });
        return;
      }
      if (message?.type === "A21_STAGE") {
        const state = await loadState();
        const job = state?.jobs?.find((item) => item.id === message.jobId);
        if (state && job && job.status === "RUNNING") {
          job.stage = String(message.stage || job.stage);
          job.selectedRowCount = Number(message.selectedRowCount || job.selectedRowCount || 0);
          job.totalResultCount = Number(message.totalResultCount || job.totalResultCount || 0);
          job.message = String(message.message || job.message || "");
          job.updatedAt = now();
          await saveState(state);
        }
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === "A21_SPLIT_REQUIRED") {
        await splitBatch(String(message.jobId), Number(message.totalResultCount || 0));
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === "A21_JOB_SUCCESS") {
        await completeJob(String(message.jobId), message);
        sendResponse({ ok: true });
        return;
      }
      if (message?.type === "A21_JOB_FAILURE") {
        await failJob(String(message.jobId), String(message.code || "A21_JOB_FAILED"), String(message.message || "작업 실패"));
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false, error: "unsupported_message" });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
  return true;
});

"use strict";

const MARKET_SEND_START_MESSAGE = "commerce-os-shopling-market-send-start";
const MARKET_SEND_CONTEXT_MESSAGE = "commerce-os-shopling-market-send-context";
const MARKET_SEND_STAGE_MESSAGE = "commerce-os-shopling-market-send-stage";
const MARKET_SEND_RESULT_MESSAGE = "commerce-os-shopling-market-send-result";
const MARKET_SEND_PROGRESS_MESSAGE = "commerce-os-shopling-market-send-progress";
const MARKET_RUN_STORAGE_KEY = "commerceOsShoplingMarketSendRun";
const MARKET_LAST_RUN_STORAGE_KEY = "commerceOsShoplingMarketSendLastRun";
const MARKET_MAX_LANES = 2;
const MARKET_MAX_AUTO_RETRIES = 1;
const MARKET_TASK_TIMEOUT_MS = 180000;

const MARKET_CHANNELS = Object.freeze([
  { searchCode: "DM1", profile: "도매1" },
  { searchCode: "DM2", profile: "도매2" },
  { searchCode: "DM3", profile: "도매3" },
  { searchCode: "DM4", profile: "도매4" },
  { searchCode: "SM1", profile: "소매1" },
  { searchCode: "SM2", profile: "소매2" },
]);

function marketText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function marketRunId() {
  return `shopling-market-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function marketTaskToken(runId, index, attempt) {
  return `${runId}-${index}-${attempt}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadMarketRun() {
  const stored = await chrome.storage.session.get(MARKET_RUN_STORAGE_KEY);
  return stored?.[MARKET_RUN_STORAGE_KEY] || null;
}

async function saveMarketRun(run) {
  if (!run) {
    await chrome.storage.session.remove(MARKET_RUN_STORAGE_KEY);
    return;
  }
  await chrome.storage.session.set({ [MARKET_RUN_STORAGE_KEY]: run });
}

async function saveMarketLastRun(run) {
  if (!run) return;
  const snapshot = {
    runId: run.runId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt || new Date().toISOString(),
    total: run.tasks.length,
    done: run.done,
    sent: run.sent,
    skipped: run.skipped,
    failed: run.failed,
    confirmNeeded: run.confirmNeeded,
    retryCount: run.retryCount,
    tasks: run.tasks.map((task) => ({
      searchCode: task.searchCode,
      profile: task.profile,
      status: task.status,
      outcome: task.outcome || "",
      reasonCode: task.reasonCode || "",
      message: task.message || "",
      attempts: Number(task.attempt || 0),
      finishedAt: task.finishedAt || "",
    })),
  };
  await chrome.storage.local.set({ [MARKET_LAST_RUN_STORAGE_KEY]: snapshot });
}

async function safeCloseMarketWindow(windowId) {
  if (!Number.isInteger(windowId)) return;
  try {
    await chrome.windows.remove(windowId);
  } catch {
    // Shopling or the operator may already have closed it.
  }
}

async function closeTaskWindows(task) {
  const ids = Array.isArray(task?.windowIds) ? [...new Set(task.windowIds)] : [];
  await Promise.all(ids.map((windowId) => safeCloseMarketWindow(windowId)));
}

function marketProgressPayload(run, extra = {}) {
  return {
    type: MARKET_SEND_PROGRESS_MESSAGE,
    status: run.status,
    total: run.tasks.length,
    done: run.done,
    sent: run.sent,
    skipped: run.skipped,
    failed: run.failed,
    confirmNeeded: run.confirmNeeded,
    retryCount: run.retryCount,
    active: run.tasks.filter((task) => task.status === "running").map((task) => ({
      searchCode: task.searchCode,
      profile: task.profile,
      stage: task.stage || "",
      attempt: Number(task.attempt || 0),
    })),
    tasks: run.tasks.map((task) => ({
      searchCode: task.searchCode,
      profile: task.profile,
      status: task.status,
      outcome: task.outcome || "",
      reasonCode: task.reasonCode || "",
      message: task.message || "",
      attempts: Number(task.attempt || 0),
    })),
    ...extra,
  };
}

async function notifyMarketOrigin(run, extra = {}) {
  if (!run || !Number.isInteger(run.originTabId)) return;
  try {
    await chrome.tabs.sendMessage(run.originTabId, marketProgressPayload(run, extra));
  } catch {
    // The origin Shopling tab can be closed without corrupting the queue.
  }
}

function marketWorkerUrl(originUrl, token, lane) {
  const url = new URL(originUrl);
  url.searchParams.set("commerce_os_market_token", token);
  url.searchParams.set("commerce_os_market_lane", String(lane));
  return url.href;
}

function taskByToken(run, token) {
  return run?.tasks?.find((task) => task.token === token) || null;
}

function taskByWindow(run, windowId) {
  if (!Number.isInteger(windowId)) return null;
  return run?.tasks?.find(
    (task) => Array.isArray(task.windowIds) && task.windowIds.includes(windowId),
  ) || null;
}

async function finishMarketRunIfDone(run) {
  if (!run || run.status !== "running") return false;
  if (run.done < run.tasks.length) return false;
  run.status = "completed";
  run.finishedAt = new Date().toISOString();
  await saveMarketRun(run);
  await saveMarketLastRun(run);
  await notifyMarketOrigin(run);
  await saveMarketRun(null);
  return true;
}

async function markMarketTaskComplete(run, task, outcome, detail = {}) {
  if (!run || !task || task.status !== "running") return;
  task.status = outcome === "sent" || outcome === "skipped" ? "completed" : outcome;
  task.outcome = outcome;
  task.reasonCode = marketText(detail.reasonCode);
  task.message = marketText(detail.message);
  task.finishedAt = new Date().toISOString();
  task.stage = "completed";

  if (outcome === "sent") run.sent += 1;
  else if (outcome === "skipped") run.skipped += 1;
  else if (outcome === "confirm") run.confirmNeeded += 1;
  else run.failed += 1;
  run.done += 1;

  await saveMarketRun(run);
  await notifyMarketOrigin(run);
  await closeTaskWindows(task);
  task.windowIds = [];
  task.submittedWindowId = null;
  await saveMarketRun(run);

  if (!(await finishMarketRunIfDone(run))) {
    await pumpMarketQueue();
  }
}

async function retryOrFinishMarketTask(run, task, detail = {}) {
  if (!run || !task || task.status !== "running") return;
  const retryable = detail.retryable !== false && task.stage !== "submitted";
  if (retryable && Number(task.attempt || 0) <= MARKET_MAX_AUTO_RETRIES) {
    task.status = "restarting";
    task.stage = "retrying";
    task.reasonCode = marketText(detail.reasonCode);
    task.message = marketText(detail.message);
    task.token = "";
    task.submittedWindowId = null;
    run.retryCount += 1;
    await saveMarketRun(run);
    await notifyMarketOrigin(run, { retrying: true });

    await closeTaskWindows(task);
    task.windowIds = [];
    task.status = "queued";
    await saveMarketRun(run);
    await pumpMarketQueue();
    return;
  }
  await markMarketTaskComplete(run, task, "failed", detail);
}

function armMarketWatchdog(runId, taskId, token) {
  setTimeout(() => {
    void (async () => {
      const run = await loadMarketRun();
      if (!run || run.runId !== runId || run.status !== "running") return;
      const task = run.tasks.find((row) => row.id === taskId);
      if (!task || task.status !== "running" || task.token !== token) return;
      if (task.stage === "submitted") {
        await markMarketTaskComplete(run, task, "confirm", {
          reasonCode: "submit_result_timeout",
          message: `${task.searchCode}→${task.profile} 송신 클릭 후 결과를 자동 판별하지 못했습니다. 중복 재전송은 막았습니다.`,
        });
        return;
      }
      await retryOrFinishMarketTask(run, task, {
        reasonCode: "task_timeout",
        message: `${task.searchCode}→${task.profile} 자동화가 ${MARKET_TASK_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다.`,
      });
    })();
  }, MARKET_TASK_TIMEOUT_MS);
}

async function startMarketTask(run, task, lane) {
  task.status = "running";
  task.attempt = Number(task.attempt || 0) + 1;
  task.stage = "opening";
  task.startedAt = new Date().toISOString();
  task.token = marketTaskToken(run.runId, task.index, task.attempt);
  task.lane = lane;
  task.windowIds = [];
  task.submittedWindowId = null;
  await saveMarketRun(run);
  await notifyMarketOrigin(run);

  const taskId = task.id;
  const token = task.token;
  try {
    const created = await chrome.windows.create({
      url: marketWorkerUrl(run.originUrl, token, lane),
      focused: false,
      type: "normal",
    });
    const current = await loadMarketRun();
    if (!current || current.runId !== run.runId || current.status !== "running") return;
    const currentTask = current.tasks.find((row) => row.id === taskId);
    if (!currentTask || currentTask.status !== "running" || currentTask.token !== token) return;
    if (Number.isInteger(created?.id) && !currentTask.windowIds.includes(created.id)) {
      currentTask.windowIds.push(created.id);
    }
    if (["opening", "worker-opened"].includes(currentTask.stage)) currentTask.stage = "worker-opened";
    await saveMarketRun(current);
    await notifyMarketOrigin(current);
    armMarketWatchdog(current.runId, currentTask.id, token);
  } catch (error) {
    const current = await loadMarketRun();
    if (!current || current.runId !== run.runId || current.status !== "running") return;
    const currentTask = current.tasks.find((row) => row.id === taskId);
    if (!currentTask || currentTask.status !== "running" || currentTask.token !== token) return;
    await retryOrFinishMarketTask(current, currentTask, {
      reasonCode: "worker_window_open_failed",
      message: error instanceof Error ? error.message : String(error || "Shopling 작업 창 열기 실패"),
    });
  }
}

async function pumpMarketQueue() {
  const run = await loadMarketRun();
  if (!run || run.status !== "running") return;
  if (await finishMarketRunIfDone(run)) return;

  const running = run.tasks.filter((task) => task.status === "running");
  const usedLanes = new Set(running.map((task) => Number(task.lane || 0)).filter(Boolean));
  const availableLanes = [];
  for (let lane = 1; lane <= MARKET_MAX_LANES; lane += 1) {
    if (!usedLanes.has(lane)) availableLanes.push(lane);
  }

  for (const lane of availableLanes) {
    const next = run.tasks.find((task) => task.status === "queued");
    if (!next) break;
    await startMarketTask(run, next, lane);
  }
}

async function startMarketRun(originUrl, originTabId) {
  const existing = await loadMarketRun();
  if (existing?.status === "running") {
    return { ok: false, message: "이미 Shopling 마켓 자동전송이 진행 중입니다." };
  }
  let normalizedOrigin;
  try {
    normalizedOrigin = new URL(originUrl);
  } catch {
    return { ok: false, message: "Shopling 상품조회 화면 URL을 확인하지 못했습니다." };
  }
  if (normalizedOrigin.hostname !== "a.shopling.co.kr") {
    return { ok: false, message: "Shopling 상품조회 화면에서 실행해 주세요." };
  }
  normalizedOrigin.searchParams.delete("commerce_os_market_token");
  normalizedOrigin.searchParams.delete("commerce_os_market_lane");

  const run = {
    runId: marketRunId(),
    originUrl: normalizedOrigin.href,
    originTabId,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: "",
    done: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    confirmNeeded: 0,
    retryCount: 0,
    tasks: MARKET_CHANNELS.map((channel, index) => ({
      id: `market-task-${index + 1}`,
      index,
      searchCode: channel.searchCode,
      profile: channel.profile,
      status: "queued",
      outcome: "",
      stage: "queued",
      attempt: 0,
      lane: 0,
      token: "",
      windowIds: [],
      submittedWindowId: null,
      reasonCode: "",
      message: "",
      startedAt: "",
      finishedAt: "",
    })),
  };
  await chrome.storage.local.remove(MARKET_LAST_RUN_STORAGE_KEY);
  await saveMarketRun(run);
  await notifyMarketOrigin(run);
  await pumpMarketQueue();
  return { ok: true, runId: run.runId, total: run.tasks.length, lanes: MARKET_MAX_LANES };
}

async function registerTaskWindow(run, task, sender) {
  const windowId = sender?.tab?.windowId;
  if (!Number.isInteger(windowId)) return;
  task.windowIds = Array.isArray(task.windowIds) ? task.windowIds : [];
  if (!task.windowIds.includes(windowId)) {
    task.windowIds.push(windowId);
    await saveMarketRun(run);
  }
}

async function marketContext(message, sender) {
  const run = await loadMarketRun();
  if (!run || run.status !== "running") return { ok: false, message: "실행 중인 마켓 자동전송이 없습니다." };
  const token = marketText(message.token);
  const task = taskByToken(run, token);
  if (!task || task.status !== "running") return { ok: false, message: "현재 작업 토큰을 찾지 못했습니다." };
  await registerTaskWindow(run, task, sender);
  return {
    ok: true,
    runId: run.runId,
    taskId: task.id,
    searchCode: task.searchCode,
    profile: task.profile,
    attempt: Number(task.attempt || 0),
    lane: Number(task.lane || 0),
    stage: task.stage || "",
  };
}

async function marketStage(message, sender) {
  const run = await loadMarketRun();
  if (!run || run.status !== "running") return { ok: false };
  const task = taskByToken(run, marketText(message.token));
  if (!task || task.status !== "running") return { ok: false };
  await registerTaskWindow(run, task, sender);
  task.stage = marketText(message.stage) || task.stage;
  if (task.stage === "submitted" && Number.isInteger(sender?.tab?.windowId)) {
    task.submittedWindowId = sender.tab.windowId;
  }
  if (message.message) task.message = marketText(message.message);
  await saveMarketRun(run);
  await notifyMarketOrigin(run);
  return { ok: true };
}

async function marketResult(message, sender) {
  const run = await loadMarketRun();
  if (!run || run.status !== "running") return { ok: false };
  const task = taskByToken(run, marketText(message.token));
  if (!task || task.status !== "running") return { ok: false };
  await registerTaskWindow(run, task, sender);
  const outcome = marketText(message.outcome);
  const detail = {
    reasonCode: marketText(message.reasonCode),
    message: marketText(message.message),
    retryable: message.retryable !== false,
  };
  if (outcome === "sent" || outcome === "skipped" || outcome === "confirm") {
    await markMarketTaskComplete(run, task, outcome, detail);
  } else {
    await retryOrFinishMarketTask(run, task, detail);
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  if (message.type === MARKET_SEND_START_MESSAGE) {
    startMarketRun(message.originUrl, sender.tab?.id)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        message: error instanceof Error ? error.message : String(error || "market send start failed"),
      }));
    return true;
  }
  if (message.type === MARKET_SEND_CONTEXT_MESSAGE) {
    marketContext(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === MARKET_SEND_STAGE_MESSAGE) {
    marketStage(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === MARKET_SEND_RESULT_MESSAGE) {
    marketResult(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  return false;
});

chrome.windows.onRemoved.addListener((windowId) => {
  void (async () => {
    const run = await loadMarketRun();
    if (!run || run.status !== "running") return;
    const task = taskByWindow(run, windowId);
    if (!task || task.status !== "running") return;
    task.windowIds = (task.windowIds || []).filter((id) => id !== windowId);
    await saveMarketRun(run);

    if (task.stage === "submitted" && task.submittedWindowId === windowId) {
      setTimeout(() => {
        void (async () => {
          const current = await loadMarketRun();
          if (!current || current.runId !== run.runId || current.status !== "running") return;
          const currentTask = current.tasks.find((row) => row.id === task.id);
          if (!currentTask || currentTask.status !== "running" || currentTask.stage !== "submitted") return;
          if (currentTask.submittedWindowId !== windowId) return;
          await markMarketTaskComplete(current, currentTask, "sent", {
            reasonCode: "shopling_window_closed_after_submit",
            message: `${currentTask.searchCode}→${currentTask.profile} Shopling 송신 창이 정상 종료되었습니다.`,
          });
        })();
      }, 1800);
      return;
    }

    if (!task.windowIds.length) {
      await retryOrFinishMarketTask(run, task, {
        reasonCode: "worker_window_closed",
        message: `${task.searchCode}→${task.profile} 작업 창이 송신 전에 닫혔습니다.`,
      });
    }
  })();
});

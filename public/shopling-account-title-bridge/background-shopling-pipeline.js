"use strict";

const PIPE_API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-account-title-bridge/pipeline";
const PIPE_BRIDGE_VERSION = "v0.5.0";
const PIPE_CLAIM_MESSAGE = "commerce-os-shopling-pipeline-claim";
const PIPE_REPORT_MESSAGE = "commerce-os-shopling-pipeline-report";
const PIPE_MARKET_START_MESSAGE = "commerce-os-shopling-pipeline-market-start";
const PIPE_MARKET_CONTEXT_MESSAGE = "commerce-os-shopling-pipeline-market-context";
const PIPE_MARKET_STAGE_MESSAGE = "commerce-os-shopling-pipeline-market-stage";
const PIPE_MARKET_RESULT_MESSAGE = "commerce-os-shopling-pipeline-market-result";
const PIPE_MARKET_ARM_SUBMIT_MESSAGE = "commerce-os-shopling-pipeline-market-arm-submit";
const PIPE_MARKET_PROGRESS_MESSAGE = "commerce-os-shopling-pipeline-market-progress";
const PIPE_MARKET_RUN_KEY = "commerceOsShoplingPipelineMarketRun";
const PIPE_MARKET_LAST_RUN_KEY = "commerceOsShoplingPipelineMarketLastRun";
const PIPE_MAX_LANES = 2;
const PIPE_MAX_TASKS = 300;
const PIPE_MAX_AUTO_RETRIES = 1;
const PIPE_TASK_TIMEOUT_MS = 180000;
const PIPE_PRODUCT_LIST_URL = "https://a.shopling.co.kr/prod/prodList.phtml";

function pipeText(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function pipeRunId() {
  return `shopling-pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function pipeTaskToken(runId, index, attempt) {
  return `${runId}-${index}-${attempt}-${Math.random().toString(36).slice(2, 9)}`;
}

async function pipeApi(body) {
  try {
    const response = await fetch(PIPE_API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bridge: PIPE_BRIDGE_VERSION, ...body }),
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      return {
        ok: false,
        error: pipeText(payload?.error) || `pipeline_http_${response.status}`,
        message: pipeText(payload?.message),
      };
    }
    return payload;
  } catch (error) {
    return {
      ok: false,
      error: "pipeline_transport_failed",
      message: error instanceof Error ? error.message : String(error || "pipeline request failed"),
    };
  }
}

async function pipeClaim(runId) {
  return pipeApi({ action: "claim", runId, groupLimit: 50 });
}

async function pipeReport(runId, goodsKey, outcome, reasonCode = "", message = "") {
  return pipeApi({ action: "report", runId, goodsKey, outcome, reasonCode, message });
}

async function pipeArmSubmit(runId, goodsKey) {
  return pipeApi({ action: "arm-submit", runId, goodsKey });
}

function pipeNormalizeTask(task, index) {
  const goodsKey = pipeText(task?.goodsKey);
  const ptnGoodsCd = pipeText(task?.ptnGoodsCd);
  const searchCode = pipeText(task?.searchCode).toUpperCase();
  const profile = pipeText(task?.profile);
  const productGroupKey = pipeText(task?.productGroupKey);
  if (!/^\d{5,9}$/.test(goodsKey)) return null;
  if (!/^(?:DM[1-4]|SM[1-2])$/.test(searchCode)) return null;
  if (!/^(?:도매[1-4]|소매[1-2])$/.test(profile)) return null;
  if (!ptnGoodsCd || !ptnGoodsCd.toUpperCase().startsWith(`${searchCode}_`)) return null;
  return {
    id: `pipeline-market-${index + 1}-${goodsKey}`,
    index,
    goodsKey,
    launchItemId: pipeText(task?.launchItemId),
    modelNumber: pipeText(task?.modelNumber),
    productGroupKey,
    searchCode,
    profile,
    ptnGoodsCd,
    registeredAt: pipeText(task?.registeredAt),
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
    serverRecorded: false,
  };
}

async function pipeLoadMarketRun() {
  const stored = await chrome.storage.session.get(PIPE_MARKET_RUN_KEY);
  return stored?.[PIPE_MARKET_RUN_KEY] || null;
}

async function pipeSaveMarketRun(run) {
  if (!run) {
    await chrome.storage.session.remove(PIPE_MARKET_RUN_KEY);
    return;
  }
  await chrome.storage.session.set({ [PIPE_MARKET_RUN_KEY]: run });
}

async function pipeSaveLastRun(run) {
  if (!run) return;
  await chrome.storage.local.set({
    [PIPE_MARKET_LAST_RUN_KEY]: {
      runId: run.runId,
      claimRunId: run.claimRunId,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt || new Date().toISOString(),
      total: run.tasks.length,
      done: run.done,
      sent: run.sent,
      alreadyRegistered: run.alreadyRegistered,
      failed: run.failed,
      confirmNeeded: run.confirmNeeded,
      retryCount: run.retryCount,
      tasks: run.tasks.map((task) => ({
        goodsKey: task.goodsKey,
        ptnGoodsCd: task.ptnGoodsCd,
        searchCode: task.searchCode,
        profile: task.profile,
        modelNumber: task.modelNumber,
        status: task.status,
        outcome: task.outcome,
        reasonCode: task.reasonCode,
        message: task.message,
        attempts: Number(task.attempt || 0),
        serverRecorded: task.serverRecorded === true,
      })),
    },
  });
}

function pipeProgress(run, extra = {}) {
  return {
    type: PIPE_MARKET_PROGRESS_MESSAGE,
    status: run.status,
    total: run.tasks.length,
    done: run.done,
    sent: run.sent,
    alreadyRegistered: run.alreadyRegistered,
    failed: run.failed,
    confirmNeeded: run.confirmNeeded,
    retryCount: run.retryCount,
    active: run.tasks.filter((task) => task.status === "running").map((task) => ({
      goodsKey: task.goodsKey,
      ptnGoodsCd: task.ptnGoodsCd,
      searchCode: task.searchCode,
      profile: task.profile,
      stage: task.stage,
      attempt: task.attempt,
    })),
    tasks: run.tasks.map((task) => ({
      goodsKey: task.goodsKey,
      ptnGoodsCd: task.ptnGoodsCd,
      searchCode: task.searchCode,
      profile: task.profile,
      modelNumber: task.modelNumber,
      status: task.status,
      outcome: task.outcome,
      reasonCode: task.reasonCode,
      message: task.message,
      attempts: task.attempt,
      serverRecorded: task.serverRecorded === true,
    })),
    ...extra,
  };
}

async function pipeNotifyOrigin(run, extra = {}) {
  if (!run || !Number.isInteger(run.originTabId)) return;
  try {
    await chrome.tabs.sendMessage(run.originTabId, pipeProgress(run, extra));
  } catch {
    // Closing the origin tab does not change the durable server claim.
  }
}

async function pipeSafeCloseWindow(windowId) {
  if (!Number.isInteger(windowId)) return;
  try {
    await chrome.windows.remove(windowId);
  } catch {
    // Already closed by Shopling or the operator.
  }
}

async function pipeCloseTaskWindows(task) {
  const ids = Array.isArray(task?.windowIds) ? [...new Set(task.windowIds)] : [];
  await Promise.all(ids.map((windowId) => pipeSafeCloseWindow(windowId)));
}

function pipeTaskByToken(run, token) {
  return run?.tasks?.find((task) => task.token === token) || null;
}

function pipeTaskByWindow(run, windowId) {
  if (!Number.isInteger(windowId)) return null;
  return run?.tasks?.find((task) => Array.isArray(task.windowIds) && task.windowIds.includes(windowId)) || null;
}

async function pipeFinishIfDone(run) {
  if (!run || run.status !== "running" || run.done < run.tasks.length) return false;
  run.status = "completed";
  run.finishedAt = new Date().toISOString();
  await pipeSaveMarketRun(run);
  await pipeSaveLastRun(run);
  await pipeNotifyOrigin(run);
  await pipeSaveMarketRun(null);
  return true;
}

function pipeServerOutcome(outcome) {
  if (outcome === "sent") return "sent";
  if (outcome === "already_registered") return "already_registered";
  if (outcome === "confirm") return "confirm_needed";
  return "failed";
}

async function pipeCompleteTask(run, task, outcome, detail = {}) {
  if (!run || !task || task.status !== "running") return;
  const reasonCode = pipeText(detail.reasonCode);
  const message = pipeText(detail.message);
  const report = await pipeReport(run.claimRunId, task.goodsKey, pipeServerOutcome(outcome), reasonCode, message);

  task.serverRecorded = report?.ok === true;
  task.finishedAt = new Date().toISOString();
  task.stage = "completed";
  task.reasonCode = reasonCode;
  task.message = message;
  task.outcome = outcome;

  if (report?.ok !== true) {
    task.status = "confirm";
    task.outcome = "confirm";
    task.reasonCode = "durable_report_failed";
    task.message = `Shopling 작업은 종료됐지만 Commerce OS 원장 기록을 확인하지 못했습니다. 자동 재작업은 차단됩니다. ${pipeText(report?.message || report?.error)}`;
    run.confirmNeeded += 1;
  } else if (outcome === "sent") {
    task.status = "completed";
    run.sent += 1;
  } else if (outcome === "already_registered") {
    task.status = "completed";
    run.alreadyRegistered += 1;
  } else if (outcome === "confirm") {
    task.status = "confirm";
    run.confirmNeeded += 1;
  } else {
    task.status = "failed";
    run.failed += 1;
  }
  run.done += 1;

  await pipeSaveMarketRun(run);
  await pipeNotifyOrigin(run);
  await pipeCloseTaskWindows(task);
  task.windowIds = [];
  task.submittedWindowId = null;
  await pipeSaveMarketRun(run);
  if (!(await pipeFinishIfDone(run))) await pipePumpQueue();
}

async function pipeRetryOrFail(run, task, detail = {}) {
  if (!run || !task || task.status !== "running") return;
  const stage = pipeText(task.stage);
  const canRetry = detail.retryable !== false && !["submit-armed", "submitted"].includes(stage);
  if (canRetry && Number(task.attempt || 0) <= PIPE_MAX_AUTO_RETRIES) {
    task.status = "restarting";
    task.stage = "retrying";
    task.reasonCode = pipeText(detail.reasonCode);
    task.message = pipeText(detail.message);
    task.token = "";
    task.submittedWindowId = null;
    run.retryCount += 1;
    await pipeSaveMarketRun(run);
    await pipeNotifyOrigin(run, { retrying: true });
    await pipeCloseTaskWindows(task);
    task.windowIds = [];
    task.status = "queued";
    await pipeSaveMarketRun(run);
    await pipePumpQueue();
    return;
  }
  await pipeCompleteTask(run, task, stage === "submit-armed" || stage === "submitted" ? "confirm" : "failed", detail);
}

function pipeArmWatchdog(runId, taskId, token) {
  setTimeout(() => {
    void (async () => {
      const run = await pipeLoadMarketRun();
      if (!run || run.runId !== runId || run.status !== "running") return;
      const task = run.tasks.find((row) => row.id === taskId);
      if (!task || task.status !== "running" || task.token !== token) return;
      if (["submit-armed", "submitted"].includes(task.stage)) {
        await pipeCompleteTask(run, task, "confirm", {
          reasonCode: "submit_result_timeout",
          message: `${task.ptnGoodsCd} 송신 잠금 이후 결과를 자동 판별하지 못했습니다. 재전송하지 않습니다.`,
          retryable: false,
        });
        return;
      }
      await pipeRetryOrFail(run, task, {
        reasonCode: "task_timeout",
        message: `${task.ptnGoodsCd} 자동화가 ${PIPE_TASK_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다.`,
      });
    })();
  }, PIPE_TASK_TIMEOUT_MS);
}

async function pipeStartTask(run, task, lane) {
  task.status = "running";
  task.attempt = Number(task.attempt || 0) + 1;
  task.stage = "opening";
  task.startedAt = new Date().toISOString();
  task.token = pipeTaskToken(run.runId, task.index, task.attempt);
  task.lane = lane;
  task.windowIds = [];
  task.submittedWindowId = null;
  await pipeSaveMarketRun(run);
  await pipeNotifyOrigin(run);

  const token = task.token;
  const taskId = task.id;
  try {
    const url = new URL(PIPE_PRODUCT_LIST_URL);
    url.searchParams.set("commerce_os_pipeline_token", token);
    url.searchParams.set("commerce_os_pipeline_lane", String(lane));
    const created = await chrome.windows.create({ url: url.href, focused: false, type: "normal" });
    const current = await pipeLoadMarketRun();
    if (!current || current.runId !== run.runId || current.status !== "running") return;
    const currentTask = current.tasks.find((row) => row.id === taskId);
    if (!currentTask || currentTask.status !== "running" || currentTask.token !== token) return;
    if (Number.isInteger(created?.id) && !currentTask.windowIds.includes(created.id)) currentTask.windowIds.push(created.id);
    if (currentTask.stage === "opening") currentTask.stage = "worker-opened";
    await pipeSaveMarketRun(current);
    await pipeNotifyOrigin(current);
    pipeArmWatchdog(current.runId, currentTask.id, token);
  } catch (error) {
    const current = await pipeLoadMarketRun();
    if (!current || current.runId !== run.runId || current.status !== "running") return;
    const currentTask = current.tasks.find((row) => row.id === taskId);
    if (!currentTask || currentTask.status !== "running" || currentTask.token !== token) return;
    await pipeRetryOrFail(current, currentTask, {
      reasonCode: "worker_window_open_failed",
      message: error instanceof Error ? error.message : String(error || "Shopling 작업 창 열기 실패"),
    });
  }
}

async function pipePumpQueue() {
  const run = await pipeLoadMarketRun();
  if (!run || run.status !== "running") return;
  if (await pipeFinishIfDone(run)) return;
  const running = run.tasks.filter((task) => task.status === "running");
  const usedLanes = new Set(running.map((task) => Number(task.lane || 0)).filter(Boolean));
  for (let lane = 1; lane <= PIPE_MAX_LANES; lane += 1) {
    if (usedLanes.has(lane)) continue;
    const next = run.tasks.find((task) => task.status === "queued");
    if (!next) break;
    await pipeStartTask(run, next, lane);
  }
}

async function pipeStartMarketRun(message, originTabId) {
  const existing = await pipeLoadMarketRun();
  if (existing?.status === "running") return { ok: false, message: "이미 신규상품 마켓 전송이 진행 중입니다." };
  const claimRunId = pipeText(message?.claimRunId);
  if (!claimRunId) return { ok: false, message: "Commerce OS 작업 원장 claim id가 없습니다." };
  const inputTasks = Array.isArray(message?.tasks) ? message.tasks.slice(0, PIPE_MAX_TASKS) : [];
  const normalized = inputTasks.map(pipeNormalizeTask).filter(Boolean);
  const goodsKeys = new Set();
  const tasks = [];
  for (const task of normalized) {
    if (goodsKeys.has(task.goodsKey)) continue;
    goodsKeys.add(task.goodsKey);
    task.index = tasks.length;
    task.id = `pipeline-market-${tasks.length + 1}-${task.goodsKey}`;
    tasks.push(task);
  }
  if (!tasks.length) return { ok: true, runId: "", total: 0, lanes: PIPE_MAX_LANES, completed: true };

  const run = {
    runId: pipeRunId(),
    claimRunId,
    originTabId,
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: "",
    done: 0,
    sent: 0,
    alreadyRegistered: 0,
    failed: 0,
    confirmNeeded: 0,
    retryCount: 0,
    tasks,
  };
  await chrome.storage.local.remove(PIPE_MARKET_LAST_RUN_KEY);
  await pipeSaveMarketRun(run);
  await pipeNotifyOrigin(run);
  await pipePumpQueue();
  return { ok: true, runId: run.runId, total: tasks.length, lanes: PIPE_MAX_LANES };
}

async function pipeRegisterWindow(run, task, sender) {
  const windowId = sender?.tab?.windowId;
  if (!Number.isInteger(windowId)) return;
  task.windowIds = Array.isArray(task.windowIds) ? task.windowIds : [];
  if (!task.windowIds.includes(windowId)) {
    task.windowIds.push(windowId);
    await pipeSaveMarketRun(run);
  }
}

async function pipeContext(message, sender) {
  const run = await pipeLoadMarketRun();
  if (!run || run.status !== "running") return { ok: false, message: "실행 중인 신규상품 전송이 없습니다." };
  const task = pipeTaskByToken(run, pipeText(message?.token));
  if (!task || task.status !== "running") return { ok: false, message: "현재 작업 토큰을 찾지 못했습니다." };
  await pipeRegisterWindow(run, task, sender);
  return {
    ok: true,
    runId: run.runId,
    claimRunId: run.claimRunId,
    taskId: task.id,
    goodsKey: task.goodsKey,
    launchItemId: task.launchItemId,
    modelNumber: task.modelNumber,
    productGroupKey: task.productGroupKey,
    searchCode: task.searchCode,
    profile: task.profile,
    ptnGoodsCd: task.ptnGoodsCd,
    attempt: Number(task.attempt || 0),
    lane: Number(task.lane || 0),
    stage: task.stage,
  };
}

async function pipeStage(message, sender) {
  const run = await pipeLoadMarketRun();
  if (!run || run.status !== "running") return { ok: false };
  const task = pipeTaskByToken(run, pipeText(message?.token));
  if (!task || task.status !== "running") return { ok: false };
  await pipeRegisterWindow(run, task, sender);
  const nextStage = pipeText(message?.stage);
  if (nextStage === "submitted" && task.stage !== "submit-armed") {
    return { ok: false, message: "durable_submit_lock_required" };
  }
  task.stage = nextStage || task.stage;
  if (task.stage === "submitted" && Number.isInteger(sender?.tab?.windowId)) task.submittedWindowId = sender.tab.windowId;
  if (message?.message) task.message = pipeText(message.message);
  await pipeSaveMarketRun(run);
  await pipeNotifyOrigin(run);
  return { ok: true };
}

async function pipeArmTaskSubmit(message, sender) {
  const run = await pipeLoadMarketRun();
  if (!run || run.status !== "running") return { ok: false, message: "market_run_missing" };
  const task = pipeTaskByToken(run, pipeText(message?.token));
  if (!task || task.status !== "running") return { ok: false, message: "market_task_missing" };
  await pipeRegisterWindow(run, task, sender);
  if (["submit-armed", "submitted"].includes(task.stage)) return { ok: true, armed: true };
  const response = await pipeArmSubmit(run.claimRunId, task.goodsKey);
  if (response?.ok !== true) {
    return { ok: false, message: pipeText(response?.message || response?.error || "submit lock failed") };
  }
  task.stage = "submit-armed";
  task.message = `${task.ptnGoodsCd} 송신 잠금 완료`;
  await pipeSaveMarketRun(run);
  await pipeNotifyOrigin(run);
  return { ok: true, armed: true };
}

async function pipeResult(message, sender) {
  const run = await pipeLoadMarketRun();
  if (!run || run.status !== "running") return { ok: false };
  const task = pipeTaskByToken(run, pipeText(message?.token));
  if (!task || task.status !== "running") return { ok: false };
  await pipeRegisterWindow(run, task, sender);
  const outcome = pipeText(message?.outcome);
  const detail = {
    reasonCode: pipeText(message?.reasonCode),
    message: pipeText(message?.message),
    retryable: message?.retryable !== false,
  };
  if (["sent", "already_registered", "confirm"].includes(outcome)) {
    await pipeCompleteTask(run, task, outcome, detail);
  } else {
    await pipeRetryOrFail(run, task, detail);
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === PIPE_CLAIM_MESSAGE) {
    const runId = pipeText(message.runId) || pipeRunId();
    pipeClaim(runId).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "claim_exception",
      message: error instanceof Error ? error.message : String(error || "claim failed"),
    }));
    return true;
  }
  if (message.type === PIPE_REPORT_MESSAGE) {
    pipeReport(
      pipeText(message.runId),
      pipeText(message.goodsKey),
      pipeText(message.outcome),
      pipeText(message.reasonCode),
      pipeText(message.message),
    ).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === PIPE_MARKET_START_MESSAGE) {
    pipeStartMarketRun(message, sender.tab?.id).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      message: error instanceof Error ? error.message : String(error || "market start failed"),
    }));
    return true;
  }
  if (message.type === PIPE_MARKET_CONTEXT_MESSAGE) {
    pipeContext(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === PIPE_MARKET_STAGE_MESSAGE) {
    pipeStage(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === PIPE_MARKET_ARM_SUBMIT_MESSAGE) {
    pipeArmTaskSubmit(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message.type === PIPE_MARKET_RESULT_MESSAGE) {
    pipeResult(message, sender).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  return false;
});

chrome.windows.onRemoved.addListener((windowId) => {
  void (async () => {
    const run = await pipeLoadMarketRun();
    if (!run || run.status !== "running") return;
    const task = pipeTaskByWindow(run, windowId);
    if (!task || task.status !== "running") return;
    task.windowIds = (task.windowIds || []).filter((id) => id !== windowId);
    await pipeSaveMarketRun(run);

    if (["submit-armed", "submitted"].includes(task.stage)) {
      await pipeCompleteTask(run, task, "confirm", {
        reasonCode: "window_closed_after_submit_lock",
        message: `${task.ptnGoodsCd} 송신 잠금 이후 창이 닫혀 결과를 확정할 수 없습니다. 자동 재전송은 차단했습니다.`,
        retryable: false,
      });
      return;
    }
    if (!task.windowIds.length) {
      await pipeRetryOrFail(run, task, {
        reasonCode: "worker_window_closed",
        message: `${task.ptnGoodsCd} 작업 창이 송신 전에 닫혔습니다.`,
      });
    }
  })();
});

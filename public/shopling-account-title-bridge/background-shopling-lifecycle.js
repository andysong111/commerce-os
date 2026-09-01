"use strict";

const SHOPLING_LIFECYCLE_DIAGNOSTIC_MESSAGE = "commerce-os-shopling-lifecycle-dom-diagnostic-report";
const SHOPLING_LIFECYCLE_CLAIM_MESSAGE = "commerce-os-shopling-lifecycle-claim";
const SHOPLING_LIFECYCLE_REPORT_MESSAGE = "commerce-os-shopling-lifecycle-report";
const SHOPLING_LIFECYCLE_EXECUTION_RESULT_MESSAGE = "commerce-os-shopling-lifecycle-execution-result";
const SHOPLING_LIFECYCLE_DIAGNOSTIC_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-lifecycle-diagnostic";
const SHOPLING_LIFECYCLE_BRIDGE_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-lifecycle-bridge";
const SHOPLING_LIFECYCLE_STATUS_PROBE_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-lifecycle-status-probe";
const SHOPLING_LIFECYCLE_DIAGNOSTIC_BRIDGE = "lifecycle-dom-v0.5.5";
const SHOPLING_LIFECYCLE_QUEUE_BRIDGE = "lifecycle-v1";
const SHOPLING_LIFECYCLE_EXECUTOR_ALARM = "commerce-os-shopling-lifecycle-executor";
const SHOPLING_LIFECYCLE_EXECUTOR_RUN_KEY = "commerceOsShoplingLifecycleExecutorRun";
const SHOPLING_LIFECYCLE_EXECUTOR_TIMEOUT_MS = 5 * 60 * 1000;
const SHOPLING_LIFECYCLE_PRODUCT_LIST_URL = "https://a.shopling.co.kr/prod/prodLst.phtml";

async function postShoplingLifecycle(endpoint, payload, timeoutMs = 15000) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) {
      return {
        ok: false,
        error: String(body?.error || `shopling_lifecycle_http_${response.status}`),
        message: String(body?.message || body?.error || `shopling_lifecycle_http_${response.status}`),
      };
    }
    return body;
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error || "shopling lifecycle request failed"),
    };
  }
}

function lifecycleRunId() {
  return `shopling-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function lifecycleLoadExecutorRun() {
  try {
    const stored = await chrome.storage.local.get(SHOPLING_LIFECYCLE_EXECUTOR_RUN_KEY);
    return stored?.[SHOPLING_LIFECYCLE_EXECUTOR_RUN_KEY] || null;
  } catch {
    return null;
  }
}

async function lifecycleSaveExecutorRun(run) {
  try {
    if (!run) await chrome.storage.local.remove(SHOPLING_LIFECYCLE_EXECUTOR_RUN_KEY);
    else await chrome.storage.local.set({ [SHOPLING_LIFECYCLE_EXECUTOR_RUN_KEY]: run });
  } catch {
    // Server queue remains authoritative.
  }
}

async function lifecycleOtherShoplingWorkerBusy() {
  try {
    const stored = await chrome.storage.session.get([
      "commerceOsShoplingTitleBatchRun",
      "commerceOsShoplingPipelineMarketRun",
      "commerceOsShoplingPipelineUiRun",
    ]);
    return Boolean(
      stored?.commerceOsShoplingTitleBatchRun?.status === "running" ||
      stored?.commerceOsShoplingPipelineMarketRun?.status === "running" ||
      stored?.commerceOsShoplingPipelineUiRun?.status === "running",
    );
  } catch {
    return false;
  }
}

async function lifecycleReadCurrentSaleStatus(goodsKey) {
  if (!/^\d{5,9}$/.test(String(goodsKey || "").trim())) return "";
  const response = await postShoplingLifecycle(
    SHOPLING_LIFECYCLE_STATUS_PROBE_ENDPOINT,
    { goodsKeys: [String(goodsKey).trim()] },
    15000,
  );
  if (response?.ok !== true) return "";
  const statuses = Array.isArray(response.statuses) ? response.statuses : [];
  const snapshot = statuses.find((row) => String(row?.goodsKey || "").trim() === String(goodsKey).trim());
  if (String(snapshot?.state || "").trim() !== "READY") return "";
  const current = String(snapshot?.currentSaleStatus || "").trim();
  return /^[BC]$/.test(current) ? current : "";
}

function lifecycleExecutorUrl(task, runId, deleteExecutionEnabled, currentSaleStatus = "") {
  const url = new URL(SHOPLING_LIFECYCLE_PRODUCT_LIST_URL);
  url.searchParams.set("commerce_os_lifecycle", "1");
  url.searchParams.set("commerce_os_lifecycle_run", runId);
  url.searchParams.set("commerce_os_lifecycle_task", String(task.id || ""));
  url.searchParams.set("commerce_os_lifecycle_goods", String(task.goods_key || ""));
  url.searchParams.set("commerce_os_lifecycle_state", String(task.desired_state || ""));
  if (/^[BC]$/.test(String(currentSaleStatus || ""))) {
    url.searchParams.set("commerce_os_lifecycle_current", String(currentSaleStatus));
  }
  if (task.desired_state === "DELETE" && deleteExecutionEnabled === true) {
    url.searchParams.set("commerce_os_lifecycle_delete_canary", "1");
  }
  return url.href;
}

async function lifecycleReportTask(runId, taskId, outcome, message = "") {
  return postShoplingLifecycle(
    SHOPLING_LIFECYCLE_BRIDGE_ENDPOINT,
    {
      bridge: SHOPLING_LIFECYCLE_QUEUE_BRIDGE,
      action: "report",
      runId,
      taskId,
      outcome,
      message,
    },
    15000,
  );
}

async function lifecycleCloseTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // The Shopling page may already have closed itself.
  }
}

async function lifecycleFinishExecutorRun(run, outcome, message) {
  if (!run) return;
  await lifecycleReportTask(run.runId, run.taskId, outcome, message);
  await lifecycleCloseTab(run.tabId);
  await lifecycleSaveExecutorRun(null);
  try {
    await chrome.alarms.create(SHOPLING_LIFECYCLE_EXECUTOR_ALARM, { when: Date.now() + 5000 });
  } catch {
    // The independent recurring keeper will retry later.
  }
}

async function lifecycleRecoverTimedOutRun(run) {
  const startedAt = Date.parse(String(run?.startedAt || ""));
  if (!Number.isFinite(startedAt)) return false;
  if (Date.now() - startedAt < SHOPLING_LIFECYCLE_EXECUTOR_TIMEOUT_MS) return true;
  await lifecycleFinishExecutorRun(
    run,
    "confirm_needed",
    `Shopling 상태변경 작업이 ${SHOPLING_LIFECYCLE_EXECUTOR_TIMEOUT_MS / 60000}분 안에 검증 완료되지 않아 자동 실행을 중단했습니다.`,
  );
  return false;
}

async function lifecycleClaimOne() {
  const runId = lifecycleRunId();
  const response = await postShoplingLifecycle(
    SHOPLING_LIFECYCLE_BRIDGE_ENDPOINT,
    {
      bridge: SHOPLING_LIFECYCLE_QUEUE_BRIDGE,
      action: "claim",
      runId,
      limit: 1,
    },
    15000,
  );
  if (!response?.ok) return { ok: false, response };
  const tasks = Array.isArray(response.tasks) ? response.tasks : [];
  return {
    ok: true,
    runId,
    task: tasks[0] || null,
    deleteExecutionEnabled: response.deleteExecutionEnabled === true,
  };
}

async function lifecycleProcessExecutorQueue() {
  const existing = await lifecycleLoadExecutorRun();
  if (existing) {
    const stillRunning = await lifecycleRecoverTimedOutRun(existing);
    if (stillRunning) return;
  }
  if (await lifecycleOtherShoplingWorkerBusy()) return;

  const claimed = await lifecycleClaimOne();
  if (!claimed.ok || !claimed.task) return;
  const task = claimed.task;
  const goodsKey = String(task.goods_key || "").trim();
  const desiredState = String(task.desired_state || "").trim();
  const taskId = String(task.id || "").trim();
  if (!taskId || !/^\d{5,9}$/.test(goodsKey) || !["SELLING", "SOLD_OUT", "DELETE"].includes(desiredState)) {
    await lifecycleReportTask(claimed.runId, taskId, "confirm_needed", "Lifecycle claim payload validation failed.");
    return;
  }
  if (desiredState === "DELETE" && claimed.deleteExecutionEnabled !== true) {
    await lifecycleReportTask(claimed.runId, taskId, "confirm_needed", "삭제 Canary 서버 스위치가 꺼져 있어 삭제를 실행하지 않았습니다.");
    return;
  }

  const currentSaleStatus = desiredState === "SELLING" || desiredState === "SOLD_OUT"
    ? await lifecycleReadCurrentSaleStatus(goodsKey)
    : "";

  let tab;
  try {
    tab = await chrome.tabs.create({
      url: lifecycleExecutorUrl(task, claimed.runId, claimed.deleteExecutionEnabled, currentSaleStatus),
      active: false,
    });
  } catch (error) {
    await lifecycleReportTask(
      claimed.runId,
      taskId,
      "failed",
      error instanceof Error ? error.message : String(error || "Shopling lifecycle tab open failed"),
    );
    return;
  }

  await lifecycleSaveExecutorRun({
    runId: claimed.runId,
    taskId,
    goodsKey,
    desiredState,
    currentSaleStatus,
    tabId: tab?.id ?? null,
    startedAt: new Date().toISOString(),
  });
}

async function lifecycleEnsureExecutorAlarm() {
  try {
    const existing = await chrome.alarms.get(SHOPLING_LIFECYCLE_EXECUTOR_ALARM);
    if (!existing) {
      await chrome.alarms.create(SHOPLING_LIFECYCLE_EXECUTOR_ALARM, {
        delayInMinutes: 0.25,
        periodInMinutes: 1,
      });
    }
  } catch {
    // Missing alarm support should never break existing Shopling automation.
  }
}

void lifecycleEnsureExecutorAlarm();
chrome.runtime.onInstalled.addListener(() => void lifecycleEnsureExecutorAlarm());
chrome.runtime.onStartup.addListener(() => void lifecycleEnsureExecutorAlarm());
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== SHOPLING_LIFECYCLE_EXECUTOR_ALARM) return;
  void lifecycleProcessExecutorQueue();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === SHOPLING_LIFECYCLE_DIAGNOSTIC_MESSAGE) {
    postShoplingLifecycle(
      SHOPLING_LIFECYCLE_DIAGNOSTIC_ENDPOINT,
      {
        bridge: SHOPLING_LIFECYCLE_DIAGNOSTIC_BRIDGE,
        pathname: message.pathname,
        topFrame: message.topFrame === true,
        frameDepth: message.frameDepth,
        readyState: message.readyState,
        candidates: Array.isArray(message.candidates) ? message.candidates : [],
        forms: Array.isArray(message.forms) ? message.forms : [],
        capturedAt: message.capturedAt,
      },
      15000,
    )
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: String(error || "lifecycle diagnostic failed") }));
    return true;
  }

  if (message.type === SHOPLING_LIFECYCLE_CLAIM_MESSAGE) {
    postShoplingLifecycle(
      SHOPLING_LIFECYCLE_BRIDGE_ENDPOINT,
      {
        bridge: SHOPLING_LIFECYCLE_QUEUE_BRIDGE,
        action: "claim",
        runId: message.runId,
        limit: message.limit || 5,
      },
      15000,
    )
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: String(error || "lifecycle claim failed") }));
    return true;
  }

  if (message.type === SHOPLING_LIFECYCLE_REPORT_MESSAGE) {
    postShoplingLifecycle(
      SHOPLING_LIFECYCLE_BRIDGE_ENDPOINT,
      {
        bridge: SHOPLING_LIFECYCLE_QUEUE_BRIDGE,
        action: "report",
        runId: message.runId,
        taskId: message.taskId,
        outcome: message.outcome,
        message: message.message || "",
      },
      15000,
    )
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: String(error || "lifecycle report failed") }));
    return true;
  }

  if (message.type === SHOPLING_LIFECYCLE_EXECUTION_RESULT_MESSAGE) {
    void (async () => {
      const run = await lifecycleLoadExecutorRun();
      const runId = String(message.runId || "").trim();
      const taskId = String(message.taskId || "").trim();
      if (!run || run.runId !== runId || run.taskId !== taskId) {
        sendResponse({ ok: false, error: "lifecycle_executor_run_mismatch" });
        return;
      }
      const outcome = ["succeeded", "failed", "confirm_needed"].includes(String(message.outcome))
        ? String(message.outcome)
        : "confirm_needed";
      await lifecycleFinishExecutorRun(run, outcome, String(message.message || ""));
      sendResponse({ ok: true, recorded: true, outcome });
    })().catch((error) => sendResponse({ ok: false, message: String(error || "lifecycle execution report failed") }));
    return true;
  }

  return false;
});

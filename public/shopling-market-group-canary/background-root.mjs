"use strict";

const API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-account-title-bridge/pipeline";
const CLAIM_API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/claim";
const RELEASE_API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/release";
const API_BRIDGE = "v0.5.0";
const CLAIM_API_BRIDGE = "group-canary-v0.2.1";
const RELEASE_API_BRIDGE = "group-canary-release-v0.3.2";
const CLAIM_MESSAGE = "commerce-os-shopling-group-canary-claim";
const ARM_MESSAGE = "commerce-os-shopling-group-canary-arm";
const REPORT_MESSAGE = "commerce-os-shopling-group-canary-report";
const OPEN_WORKERS_MESSAGE = "commerce-os-shopling-parallel-workers-open";
const CLOSE_WORKER_MESSAGE = "commerce-os-shopling-parallel-worker-close";
const CONTEXT_MESSAGE = "commerce-os-shopling-parallel-worker-context";
const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV034";
const ALLOWED = new Map([
  ["DM1", "도매1"],
  ["DM2", "도매2"],
  ["DM3", "도매3"],
  ["DM4", "도매4"],
  ["SM1", "소매1"],
  ["SM2", "소매2"],
]);

let metaMutationQueue = Promise.resolve();

function text(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validRunId(runId) {
  // v0.3.4 keeps the server-compatible v030 run-id prefix.
  return /^canary-group-v030-[A-Za-z0-9._:-]{12,150}$/.test(runId);
}

async function requestJson(endpoint, payload) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) {
      return {
        ok: false,
        error: text(body?.error) || `parallel_worker_http_${response.status}`,
        message: text(body?.message),
      };
    }
    return body;
  } catch (error) {
    return {
      ok: false,
      error: "parallel_worker_transport_failed",
      message: error instanceof Error ? error.message : String(error || "request failed"),
    };
  }
}

function api(body) {
  return requestJson(API_ENDPOINT, { bridge: API_BRIDGE, ...body });
}

function claimApi(runId) {
  return requestJson(CLAIM_API_ENDPOINT, { bridge: CLAIM_API_BRIDGE, runId });
}

function releaseApi(runId, reasonCode, message) {
  return requestJson(RELEASE_API_ENDPOINT, {
    bridge: RELEASE_API_BRIDGE,
    runId,
    reasonCode,
    message,
  });
}

function normalizeTask(raw) {
  const goodsKey = text(raw?.goodsKey);
  const searchCode = text(raw?.searchCode).toUpperCase();
  const profile = text(raw?.profile);
  const ptnGoodsCd = text(raw?.ptnGoodsCd);
  const launchItemId = text(raw?.launchItemId);
  if (!/^\d{5,9}$/.test(goodsKey) || !launchItemId) return null;
  if (!ALLOWED.has(searchCode) || ALLOWED.get(searchCode) !== profile) return null;
  if (!ptnGoodsCd || !ptnGoodsCd.toUpperCase().startsWith(`${searchCode}_`)) return null;
  return {
    goodsKey,
    launchItemId,
    modelNumber: text(raw?.modelNumber),
    productGroupKey: text(raw?.productGroupKey),
    searchCode,
    profile,
    ptnGoodsCd,
    registeredAt: text(raw?.registeredAt),
  };
}

async function releaseClaimed(runId, tasks, reasonCode, message) {
  let allOk = true;
  for (const task of tasks) {
    const result = await api({
      action: "report",
      runId,
      goodsKey: task.goodsKey,
      outcome: "failed",
      reasonCode,
      message,
    });
    if (!result?.ok) allOk = false;
  }
  return allOk;
}

async function claimOneProduct(runId) {
  if (!validRunId(runId)) return { ok: false, error: "invalid_group_canary_run_id" };
  const response = await claimApi(runId);
  if (!response?.ok) return response;
  const rawTasks = Array.isArray(response.tasks) ? response.tasks : [];
  if (!rawTasks.length) return { ok: true, tasks: [], empty: true };
  const tasks = rawTasks.map(normalizeTask).filter(Boolean);
  const identities = new Set(tasks.map((task) => task.launchItemId));
  if (tasks.length !== rawTasks.length || tasks.length < 1 || tasks.length > 6 || identities.size !== 1) {
    const releasable = tasks.length
      ? tasks
      : rawTasks.map((row) => ({ goodsKey: text(row?.goodsKey) })).filter((row) => /^\d{5,9}$/.test(row.goodsKey));
    const released = await releaseClaimed(
      runId,
      releasable,
      "parallel_worker_claim_guard_failed",
      "1개 상품 범위를 벗어나 송신 전 원복했습니다.",
    );
    return {
      ok: false,
      error: released ? "parallel_worker_claim_guard_failed" : "parallel_worker_claim_guard_release_failed",
    };
  }
  const order = new Map(["DM1", "DM2", "DM3", "DM4", "SM1", "SM2"].map((code, index) => [code, index]));
  tasks.sort((a, b) => (order.get(a.searchCode) ?? 99) - (order.get(b.searchCode) ?? 99));
  return {
    ok: true,
    runId,
    tasks,
    taskCount: tasks.length,
    launchItemId: tasks[0].launchItemId,
    modelNumber: tasks[0].modelNumber,
  };
}

function getWorkerMeta() {
  return new Promise((resolve) => {
    chrome.storage.local.get(WORKER_META_KEY, (stored) => {
      void chrome.runtime.lastError;
      resolve(stored?.[WORKER_META_KEY] || null);
    });
  });
}

function setWorkerMeta(meta) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [WORKER_META_KEY]: meta }, () => {
      void chrome.runtime.lastError;
      resolve(meta);
    });
  });
}

function mutateWorkerMeta(mutator) {
  const operation = metaMutationQueue.then(async () => {
    const current = await getWorkerMeta();
    const next = await mutator(current);
    if (next === undefined) return current;
    await setWorkerMeta(next);
    return next;
  });
  metaMutationQueue = operation.catch(() => null);
  return operation;
}

function isAdminControlUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return parsed.hostname === "a.shopling.co.kr"
      && !/\/prodlinkage\/goods_mallReg_(?:idChoice|preProdChoice)\.phtml$/i.test(parsed.pathname)
      && !/\/prod_a\/prod_rgst_rspt\.phtml$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function waitForTab(tabId, predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return null;
    if (predicate(tab)) return tab;
    await sleep(150);
  }
  return null;
}

async function releaseRunBeforeSubmit(runId, reasonCode, message) {
  const result = await releaseApi(runId, reasonCode, message);
  return result?.ok ? result : {
    ok: false,
    error: result?.error || "release_failed",
    message: result?.message || "claim 원복 실패",
  };
}

async function releaseTaskBeforeSubmit(runId, task, reasonCode, message) {
  const result = await api({
    action: "report",
    runId,
    goodsKey: task.goodsKey,
    outcome: "failed",
    reasonCode,
    message,
  });
  return result?.ok ? result : {
    ok: false,
    error: result?.error || "task_release_failed",
    message: result?.message || "개별 claim 원복 실패",
  };
}

async function closeWindowIds(ids) {
  for (const id of [...new Set((ids || []).filter(Number.isInteger))]) {
    try {
      await chrome.windows.remove(id);
    } catch {
      // Already closed.
    }
  }
}

async function cloneControlTabIntoWorker(controlTabId) {
  const control = await chrome.tabs.get(controlTabId).catch(() => null);
  if (!control || !Number.isInteger(control.id) || !Number.isInteger(control.windowId) || !isAdminControlUrl(control.url)) {
    return {
      ok: false,
      error: "a18_control_tab_missing",
      message: "원본 A18 관리자 탭을 찾지 못했습니다. A18 쇼핑몰상품등록 탭을 그대로 열어두세요.",
    };
  }

  let duplicate = null;
  try {
    duplicate = await chrome.tabs.duplicate(controlTabId);
  } catch (error) {
    return {
      ok: false,
      error: "a18_duplicate_failed",
      message: error instanceof Error ? error.message : String(error || "A18 tab duplicate failed"),
    };
  }
  if (!duplicate || !Number.isInteger(duplicate.id)) {
    return { ok: false, error: "a18_duplicate_identity_missing", message: "A18 복제 탭 ID를 얻지 못했습니다." };
  }

  let workerWindow = null;
  try {
    workerWindow = await chrome.windows.create({
      tabId: duplicate.id,
      type: "normal",
      focused: false,
      width: 1220,
      height: 900,
    });
  } catch (error) {
    try { await chrome.tabs.remove(duplicate.id); } catch { /* best effort */ }
    return {
      ok: false,
      error: "a18_worker_window_create_failed",
      message: error instanceof Error ? error.message : String(error || "A18 worker window create failed"),
    };
  }

  const workerWindowId = workerWindow?.id;
  const workerTabId = workerWindow?.tabs?.[0]?.id ?? duplicate.id;
  if (!Number.isInteger(workerWindowId) || !Number.isInteger(workerTabId)) {
    if (Number.isInteger(workerWindowId)) {
      try { await chrome.windows.remove(workerWindowId); } catch { /* best effort */ }
    }
    return { ok: false, error: "a18_worker_identity_missing", message: "복제 작업창 식별에 실패했습니다." };
  }

  const ready = await waitForTab(
    workerTabId,
    (tab) => tab.status === "complete" && isAdminControlUrl(tab.url),
    12000,
  );
  if (!ready) {
    try { await chrome.windows.remove(workerWindowId); } catch { /* best effort */ }
    return {
      ok: false,
      error: "a18_worker_not_ready",
      message: "복제된 A18 작업창이 정상 관리자 화면으로 준비되지 않았습니다.",
    };
  }

  return {
    ok: true,
    controlWindowId: control.windowId,
    workerWindowId,
    workerTabId,
    a18CloneVerified: true,
  };
}

function assignmentArray(meta) {
  return Object.values(meta?.assignments && typeof meta.assignments === "object" ? meta.assignments : {});
}

function findAssignment(meta, sender, allowOpener = true) {
  if (!meta || !sender?.tab) return null;
  const tabId = sender.tab.id;
  const windowId = sender.tab.windowId;
  const openerTabId = sender.tab.openerTabId;
  for (const assignment of assignmentArray(meta)) {
    const tabs = Array.isArray(assignment?.tabIds) ? assignment.tabIds : [];
    const windows = Array.isArray(assignment?.windowIds) ? assignment.windowIds : [];
    if (tabs.includes(tabId) || windows.includes(windowId)) return assignment;
  }
  if (allowOpener && Number.isInteger(openerTabId)) {
    for (const assignment of assignmentArray(meta)) {
      const tabs = Array.isArray(assignment?.tabIds) ? assignment.tabIds : [];
      if (tabs.includes(openerTabId)) return assignment;
    }
  }
  return null;
}

async function openParallelWorkers(runId, rawTasks, sender) {
  if (!validRunId(runId)) return { ok: false, error: "invalid_parallel_worker_run_id" };
  const tasks = (Array.isArray(rawTasks) ? rawTasks : []).map(normalizeTask).filter(Boolean);
  if (!tasks.length || tasks.length > 6) return { ok: false, error: "invalid_parallel_worker_tasks" };
  const identities = new Set(tasks.map((task) => task.launchItemId));
  const goodsKeys = new Set(tasks.map((task) => task.goodsKey));
  if (identities.size !== 1 || goodsKeys.size !== tasks.length) return { ok: false, error: "parallel_worker_task_identity_invalid" };

  const previous = await getWorkerMeta();
  if (previous?.runId === runId && assignmentArray(previous).some((assignment) => assignment?.status === "active")) {
    return {
      ok: true,
      resumed: true,
      openedCount: assignmentArray(previous).filter((assignment) => assignment?.status === "active").length,
      assignments: assignmentArray(previous),
    };
  }

  const controlTabId = sender?.tab?.id ?? null;
  const controlWindowId = sender?.tab?.windowId ?? null;
  if (!Number.isInteger(controlTabId) || !Number.isInteger(controlWindowId)) {
    await releaseRunBeforeSubmit(
      runId,
      "a18_control_identity_missing",
      "원본 A18 컨트롤 탭 식별 실패로 송신 전에 claim을 원복했습니다.",
    );
    return { ok: false, error: "a18_control_identity_missing" };
  }

  const control = await chrome.tabs.get(controlTabId).catch(() => null);
  if (!control || !isAdminControlUrl(control.url)) {
    await releaseRunBeforeSubmit(
      runId,
      "a18_control_tab_missing",
      "원본 A18 관리자 탭 확인 실패로 송신 전에 claim을 원복했습니다.",
    );
    return { ok: false, error: "a18_control_tab_missing" };
  }

  await setWorkerMeta({
    runId,
    controlTabId,
    controlWindowId,
    assignments: {},
    openedAt: Date.now(),
    updatedAt: Date.now(),
  });

  const cloneResults = await Promise.allSettled(
    tasks.map(async (task) => {
      const cloned = await cloneControlTabIntoWorker(controlTabId);
      if (!cloned?.ok) throw Object.assign(new Error(text(cloned?.message || cloned?.error)), { code: cloned?.error || "a18_clone_worker_failed", task });
      const assignment = {
        goodsKey: task.goodsKey,
        task,
        rootWindowId: cloned.workerWindowId,
        rootTabId: cloned.workerTabId,
        windowIds: [cloned.workerWindowId],
        tabIds: [cloned.workerTabId],
        status: "active",
        openedAt: Date.now(),
        updatedAt: Date.now(),
      };
      await mutateWorkerMeta((meta) => {
        if (!meta || meta.runId !== runId) return meta;
        return {
          ...meta,
          assignments: { ...(meta.assignments || {}), [task.goodsKey]: assignment },
          updatedAt: Date.now(),
        };
      });
      return assignment;
    }),
  );

  const opened = [];
  const failed = [];
  for (let index = 0; index < cloneResults.length; index += 1) {
    const result = cloneResults[index];
    const task = tasks[index];
    if (result.status === "fulfilled") {
      opened.push(result.value);
      continue;
    }
    const code = text(result.reason?.code) || "a18_clone_worker_failed";
    const message = text(result.reason?.message) || "A18 복제 작업창 생성 실패";
    const released = await releaseTaskBeforeSubmit(
      runId,
      task,
      code,
      `${task.profile} 병렬 A18 복제창 생성 실패로 송신 전 claim을 원복했습니다. ${message}`,
    );
    failed.push({ goodsKey: task.goodsKey, profile: task.profile, error: code, message, released: Boolean(released?.ok) });
  }

  if (!opened.length) {
    return { ok: false, error: "parallel_worker_all_clones_failed", failed };
  }

  return {
    ok: true,
    runId,
    openedCount: opened.length,
    failedCount: failed.length,
    assignments: opened,
    failed,
    a18CloneVerified: true,
    parallel: true,
  };
}

async function recordWorkerContext(sender, allowOpener = true) {
  const meta = await getWorkerMeta();
  if (!meta || !sender?.tab) return { worker: false, control: false };
  const tabId = sender.tab.id;
  const windowId = sender.tab.windowId;
  const control = tabId === meta.controlTabId;
  let assignment = findAssignment(meta, sender, allowOpener);
  if (!assignment) return { worker: false, control, runId: meta.runId };

  const tracked = (Array.isArray(assignment.tabIds) && assignment.tabIds.includes(tabId))
    || (Array.isArray(assignment.windowIds) && assignment.windowIds.includes(windowId));
  if (!tracked && allowOpener) {
    await mutateWorkerMeta((latest) => {
      if (!latest || latest.runId !== meta.runId) return latest;
      const current = latest.assignments?.[assignment.goodsKey];
      if (!current) return latest;
      const tabs = new Set(Array.isArray(current.tabIds) ? current.tabIds : []);
      const windows = new Set(Array.isArray(current.windowIds) ? current.windowIds : []);
      if (Number.isInteger(tabId)) tabs.add(tabId);
      if (Number.isInteger(windowId)) windows.add(windowId);
      const nextAssignment = { ...current, tabIds: [...tabs], windowIds: [...windows], updatedAt: Date.now() };
      assignment = nextAssignment;
      return {
        ...latest,
        assignments: { ...latest.assignments, [current.goodsKey]: nextAssignment },
        updatedAt: Date.now(),
      };
    });
  }

  return {
    worker: true,
    control: false,
    runId: meta.runId,
    goodsKey: assignment.goodsKey,
    task: assignment.task,
  };
}

async function verifyWorkerMessage(runId, goodsKey, sender) {
  const context = await recordWorkerContext(sender, true);
  return context.worker && context.runId === runId && context.goodsKey === goodsKey ? context : null;
}

async function closeParallelWorker(runId, goodsKey, sender, preserveSender = false) {
  const meta = await getWorkerMeta();
  if (!meta || meta.runId !== runId) return { ok: true, closed: 0 };
  const assignment = meta.assignments?.[goodsKey];
  if (!assignment) return { ok: true, closed: 0 };
  const senderWindowId = sender?.tab?.windowId;
  const ids = (Array.isArray(assignment.windowIds) ? assignment.windowIds : [])
    .filter((id) => id !== meta.controlWindowId)
    .filter((id) => !preserveSender || id !== senderWindowId);

  await mutateWorkerMeta((latest) => {
    if (!latest || latest.runId !== runId) return latest;
    const current = latest.assignments?.[goodsKey];
    if (!current) return latest;
    return {
      ...latest,
      assignments: {
        ...latest.assignments,
        [goodsKey]: {
          ...current,
          status: preserveSender ? "confirm_needed" : "closed",
          windowIds: preserveSender && Number.isInteger(senderWindowId) ? [senderWindowId] : [],
          tabIds: preserveSender && Number.isInteger(sender?.tab?.id) ? [sender.tab.id] : [],
          updatedAt: Date.now(),
        },
      },
      updatedAt: Date.now(),
    };
  });

  if (ids.length) setTimeout(() => void closeWindowIds(ids), 350);
  return { ok: true, closed: ids.length };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const runId = text(message.runId);
  const goodsKey = text(message.goodsKey);

  if (message.type === CLAIM_MESSAGE) {
    claimOneProduct(runId).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "parallel_worker_claim_exception",
      message: String(error?.message || error),
    }));
    return true;
  }

  if (message.type === OPEN_WORKERS_MESSAGE) {
    openParallelWorkers(runId, message.tasks, sender).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "parallel_worker_open_exception",
      message: String(error?.message || error),
    }));
    return true;
  }

  if (message.type === CONTEXT_MESSAGE) {
    recordWorkerContext(sender, true).then(sendResponse).catch(() => sendResponse({ worker: false, control: false }));
    return true;
  }

  if (message.type === CLOSE_WORKER_MESSAGE) {
    verifyWorkerMessage(runId, goodsKey, sender).then((context) => {
      if (!context) return { ok: false, error: "parallel_worker_close_identity_mismatch" };
      return closeParallelWorker(runId, goodsKey, sender, Boolean(message.preserveSenderWindow));
    }).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "parallel_worker_close_exception",
      message: String(error?.message || error),
    }));
    return true;
  }

  if (message.type === ARM_MESSAGE) {
    verifyWorkerMessage(runId, goodsKey, sender).then((context) => {
      if (!context) return { ok: false, error: "parallel_worker_arm_identity_mismatch" };
      return api({ action: "arm-submit", runId, goodsKey });
    }).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "parallel_worker_arm_exception",
      message: String(error?.message || error),
    }));
    return true;
  }

  if (message.type === REPORT_MESSAGE) {
    verifyWorkerMessage(runId, goodsKey, sender).then((context) => {
      if (!context) return { ok: false, error: "parallel_worker_report_identity_mismatch" };
      return api({
        action: "report",
        runId,
        goodsKey,
        outcome: text(message.outcome),
        reasonCode: text(message.reasonCode),
        message: text(message.message),
      });
    }).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "parallel_worker_report_exception",
      message: String(error?.message || error),
    }));
    return true;
  }

  return false;
});

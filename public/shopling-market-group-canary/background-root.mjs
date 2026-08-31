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
const OPEN_WORKER_MESSAGE = "commerce-os-shopling-fresh-worker-open";
const CLOSE_WORKERS_MESSAGE = "commerce-os-shopling-fresh-worker-close";
const CONTEXT_MESSAGE = "commerce-os-shopling-fresh-worker-context";
const ADMIN_READY_MESSAGE = "commerce-os-shopling-fresh-worker-admin-ready";
const WORKER_META_KEY = "commerceOsShoplingFreshWorkerMetaV033";
const ALLOWED = new Map([
  ["DM1", "도매1"],
  ["DM2", "도매2"],
  ["DM3", "도매3"],
  ["DM4", "도매4"],
  ["SM1", "소매1"],
  ["SM2", "소매2"],
]);

function text(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validRunId(runId) {
  return /^canary-group-v0(?:21|30)-[A-Za-z0-9._:-]{12,150}$/.test(runId);
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
        error: text(body?.error) || `fresh_worker_http_${response.status}`,
        message: text(body?.message),
      };
    }
    return body;
  } catch (error) {
    return {
      ok: false,
      error: "fresh_worker_transport_failed",
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
      "fresh_worker_claim_guard_failed",
      "1개 상품 범위를 벗어나 송신 전 원복했습니다.",
    );
    return {
      ok: false,
      error: released ? "fresh_worker_claim_guard_failed" : "fresh_worker_claim_guard_release_failed",
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
  };
}

async function openFreshWorker(runId, sender) {
  if (!validRunId(runId)) return { ok: false, error: "invalid_fresh_worker_run_id" };
  const previous = await getWorkerMeta();
  const sameRun = previous?.runId === runId;
  const controlTabId = sameRun && Number.isInteger(previous?.controlTabId)
    ? previous.controlTabId
    : (sender?.tab?.id ?? null);
  const controlWindowId = sameRun && Number.isInteger(previous?.controlWindowId)
    ? previous.controlWindowId
    : (sender?.tab?.windowId ?? null);
  const oldWorkerWindowIds = sameRun && Array.isArray(previous?.windowIds)
    ? [...previous.windowIds]
    : [];

  if (!Number.isInteger(controlTabId) || !Number.isInteger(controlWindowId)) {
    await releaseRunBeforeSubmit(
      runId,
      "a18_control_identity_missing",
      "원본 A18 컨트롤 탭 식별 실패로 송신 전에 claim을 원복했습니다.",
    );
    return { ok: false, error: "a18_control_identity_missing" };
  }

  const cloned = await cloneControlTabIntoWorker(controlTabId);
  if (!cloned?.ok) {
    await releaseRunBeforeSubmit(
      runId,
      cloned?.error || "a18_clone_worker_failed",
      `A18 복제 작업창 생성 실패로 송신 전에 claim을 원복했습니다. ${text(cloned?.message)}`,
    );
    return cloned;
  }

  await setWorkerMeta({
    runId,
    controlTabId,
    controlWindowId,
    rootWindowId: cloned.workerWindowId,
    rootTabId: cloned.workerTabId,
    windowIds: [cloned.workerWindowId],
    tabIds: [cloned.workerTabId],
    openedAt: Date.now(),
    updatedAt: Date.now(),
  });

  const disposable = oldWorkerWindowIds
    .filter((id) => id !== cloned.workerWindowId)
    .filter((id) => id !== controlWindowId);
  if (disposable.length) setTimeout(() => void closeWindowIds(disposable), 650);

  return {
    ok: true,
    controlTabId,
    workerWindowId: cloned.workerWindowId,
    workerTabId: cloned.workerTabId,
    a18CloneVerified: true,
  };
}

async function recordWorkerContext(runId, sender, allowOpener = true) {
  const meta = await getWorkerMeta();
  if (!meta || meta.runId !== runId || !sender?.tab) return { worker: false, control: false };
  const tabId = sender.tab.id;
  const windowId = sender.tab.windowId;
  const openerTabId = sender.tab.openerTabId;
  const tabs = new Set(Array.isArray(meta.tabIds) ? meta.tabIds : []);
  const windows = new Set(Array.isArray(meta.windowIds) ? meta.windowIds : []);
  const control = tabId === meta.controlTabId;
  let worker = tabs.has(tabId) || windows.has(windowId);
  const fromWorker = Number.isInteger(openerTabId) && tabs.has(openerTabId);
  if (!worker && allowOpener && fromWorker) {
    worker = true;
    tabs.add(tabId);
    windows.add(windowId);
    await setWorkerMeta({
      ...meta,
      tabIds: [...tabs],
      windowIds: [...windows],
      updatedAt: Date.now(),
    });
  }
  return { worker, control };
}

async function closeFreshWorkers(runId, sender, preserveSender = false) {
  const meta = await getWorkerMeta();
  if (!meta || meta.runId !== runId) return { ok: true, closed: 0 };
  const senderWindowId = sender?.tab?.windowId;
  const ids = (Array.isArray(meta.windowIds) ? meta.windowIds : [])
    .filter((id) => id !== meta.controlWindowId)
    .filter((id) => !preserveSender || id !== senderWindowId);
  await setWorkerMeta({
    ...meta,
    rootWindowId: null,
    rootTabId: null,
    windowIds: preserveSender && Number.isInteger(senderWindowId) ? [senderWindowId] : [],
    tabIds: [],
    updatedAt: Date.now(),
  });
  if (ids.length) setTimeout(() => void closeWindowIds(ids), 350);
  return { ok: true, closed: ids.length };
}

async function adminReady(runId, sender) {
  const context = await recordWorkerContext(runId, sender, true);
  if (!context.worker) return { ok: false, error: "fresh_worker_admin_not_tracked" };
  const meta = await getWorkerMeta();
  if (!meta || meta.runId !== runId) return { ok: false, error: "fresh_worker_meta_missing" };
  const senderWindowId = sender?.tab?.windowId;
  const senderTabId = sender?.tab?.id;
  const windows = new Set(Array.isArray(meta.windowIds) ? meta.windowIds : []);
  const tabs = new Set(Array.isArray(meta.tabIds) ? meta.tabIds : []);
  if (Number.isInteger(senderWindowId)) windows.add(senderWindowId);
  if (Number.isInteger(senderTabId)) tabs.add(senderTabId);
  await setWorkerMeta({
    ...meta,
    rootWindowId: senderWindowId,
    rootTabId: senderTabId,
    windowIds: [...windows],
    tabIds: [...tabs],
    updatedAt: Date.now(),
  });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const runId = text(message.runId);
  if (message.type === CLAIM_MESSAGE) {
    claimOneProduct(runId).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "fresh_worker_claim_exception",
      message: String(error?.message || error),
    }));
    return true;
  }
  if (message.type === OPEN_WORKER_MESSAGE) {
    openFreshWorker(runId, sender).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "fresh_worker_open_exception",
      message: String(error?.message || error),
    }));
    return true;
  }
  if (message.type === CLOSE_WORKERS_MESSAGE) {
    closeFreshWorkers(runId, sender, Boolean(message.preserveSenderWindow)).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "fresh_worker_close_exception",
      message: String(error?.message || error),
    }));
    return true;
  }
  if (message.type === CONTEXT_MESSAGE) {
    recordWorkerContext(runId, sender, true).then(sendResponse).catch(() => sendResponse({ worker: false, control: false }));
    return true;
  }
  if (message.type === ADMIN_READY_MESSAGE) {
    adminReady(runId, sender).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "fresh_worker_admin_ready_exception",
      message: String(error?.message || error),
    }));
    return true;
  }
  if (message.type === ARM_MESSAGE) {
    void recordWorkerContext(runId, sender, true);
    api({ action: "arm-submit", runId, goodsKey: text(message.goodsKey) }).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "fresh_worker_arm_exception",
      message: String(error?.message || error),
    }));
    return true;
  }
  if (message.type === REPORT_MESSAGE) {
    void recordWorkerContext(runId, sender, true);
    api({
      action: "report",
      runId,
      goodsKey: text(message.goodsKey),
      outcome: text(message.outcome),
      reasonCode: text(message.reasonCode),
      message: text(message.message),
    }).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "fresh_worker_report_exception",
      message: String(error?.message || error),
    }));
    return true;
  }
  return false;
});

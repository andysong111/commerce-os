"use strict";

const API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-account-title-bridge/pipeline";
const API_BRIDGE = "v0.5.0";
const CLAIM_API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/claim";
const CLAIM_API_BRIDGE = "group-canary-v0.2.1";

const CLAIM_MESSAGE = "commerce-os-shopling-group-canary-claim";
const ARM_MESSAGE = "commerce-os-shopling-group-canary-arm";
const REPORT_MESSAGE = "commerce-os-shopling-group-canary-report";
const OPEN_WORKER_MESSAGE = "commerce-os-shopling-fresh-worker-open";
const CLOSE_WORKERS_MESSAGE = "commerce-os-shopling-fresh-worker-close";
const CONTEXT_MESSAGE = "commerce-os-shopling-fresh-worker-context";
const ADMIN_READY_MESSAGE = "commerce-os-shopling-fresh-worker-admin-ready";
const WORKER_META_KEY = "commerceOsShoplingFreshWorkerMetaV030";
const ADMIN_HOME_URL = "https://a.shopling.co.kr/";

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
      message: error instanceof Error ? error.message : String(error || "fresh worker request failed"),
    };
  }
}

function api(body) {
  return requestJson(API_ENDPOINT, { bridge: API_BRIDGE, ...body });
}

function claimApi(runId) {
  return requestJson(CLAIM_API_ENDPOINT, { bridge: CLAIM_API_BRIDGE, runId });
}

function normalizeTask(raw) {
  const goodsKey = text(raw?.goodsKey);
  const searchCode = text(raw?.searchCode).toUpperCase();
  const profile = text(raw?.profile);
  const ptnGoodsCd = text(raw?.ptnGoodsCd);
  const launchItemId = text(raw?.launchItemId);
  if (!/^\d{5,9}$/.test(goodsKey)) return null;
  if (!ALLOWED.has(searchCode) || ALLOWED.get(searchCode) !== profile) return null;
  if (!ptnGoodsCd || !ptnGoodsCd.toUpperCase().startsWith(`${searchCode}_`)) return null;
  if (!launchItemId) return null;
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
    const response = await api({
      action: "report",
      runId,
      goodsKey: task.goodsKey,
      outcome: "failed",
      reasonCode,
      message,
    });
    if (!response?.ok) allOk = false;
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
  const identityKeys = new Set(tasks.map((task) => task.launchItemId));
  const valid = tasks.length === rawTasks.length
    && tasks.length >= 1
    && tasks.length <= 6
    && identityKeys.size === 1;
  if (!valid) {
    const releasable = tasks.length
      ? tasks
      : rawTasks.map((row) => ({ goodsKey: text(row?.goodsKey) })).filter((row) => /^\d{5,9}$/.test(row.goodsKey));
    const released = await releaseClaimed(
      runId,
      releasable,
      "fresh_worker_claim_guard_failed",
      "1개 상품의 최대 6채널 조건을 만족하지 않아 송신 전 원복했습니다.",
    );
    return {
      ok: false,
      error: released ? "fresh_worker_claim_guard_failed" : "fresh_worker_claim_guard_release_failed",
      message: "원장이 1개 상품 범위를 벗어나 자동 송신하지 않았습니다.",
    };
  }
  const order = new Map(["DM1", "DM2", "DM3", "DM4", "SM1", "SM2"].map((code, index) => [code, index]));
  tasks.sort((a, b) => (order.get(a.searchCode) ?? 99) - (order.get(b.searchCode) ?? 99));
  return {
    ok: true,
    runId,
    tasks,
    taskCount: tasks.length,
    launchItemId: tasks[0]?.launchItemId || "",
    modelNumber: tasks[0]?.modelNumber || "",
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

async function recordWorkerContext(runId, sender, allowOpenerAdoption = true) {
  const meta = await getWorkerMeta();
  if (!meta || meta.runId !== runId || !sender?.tab) return { worker: false, control: false };
  const tabId = sender.tab.id;
  const windowId = sender.tab.windowId;
  const openerTabId = sender.tab.openerTabId;
  const tabIds = new Set(Array.isArray(meta.tabIds) ? meta.tabIds : []);
  const windowIds = new Set(Array.isArray(meta.windowIds) ? meta.windowIds : []);
  const control = tabId === meta.controlTabId;
  let worker = tabIds.has(tabId) || windowIds.has(windowId);
  if (!worker && allowOpenerAdoption && Number.isInteger(openerTabId) && tabIds.has(openerTabId)) {
    worker = true;
    tabIds.add(tabId);
    windowIds.add(windowId);
    await setWorkerMeta({
      ...meta,
      tabIds: [...tabIds],
      windowIds: [...windowIds],
      updatedAt: Date.now(),
    });
  }
  return { worker, control };
}

async function closeWindowIds(windowIds) {
  const unique = [...new Set((windowIds || []).filter(Number.isInteger))];
  for (const windowId of unique) {
    try {
      await chrome.windows.remove(windowId);
    } catch {
      // Already closed or inaccessible.
    }
  }
}

async function openFreshWorker(runId, sender) {
  if (!validRunId(runId)) return { ok: false, error: "invalid_fresh_worker_run_id" };
  const previous = await getWorkerMeta();
  const oldWindowIds = previous?.runId === runId && Array.isArray(previous.windowIds)
    ? [...previous.windowIds]
    : [];
  const controlTabId = sender?.tab?.id ?? previous?.controlTabId ?? null;
  const controlWindowId = sender?.tab?.windowId ?? previous?.controlWindowId ?? null;

  let created;
  try {
    created = await chrome.windows.create({
      url: ADMIN_HOME_URL,
      type: "normal",
      focused: false,
      width: 1220,
      height: 900,
    });
  } catch (error) {
    return {
      ok: false,
      error: "fresh_worker_window_create_failed",
      message: error instanceof Error ? error.message : String(error || "window create failed"),
    };
  }

  const workerWindowId = created?.id;
  const workerTabId = created?.tabs?.[0]?.id;
  if (!Number.isInteger(workerWindowId) || !Number.isInteger(workerTabId)) {
    if (Number.isInteger(workerWindowId)) {
      try { await chrome.windows.remove(workerWindowId); } catch { /* best effort */ }
    }
    return { ok: false, error: "fresh_worker_window_identity_missing" };
  }

  await setWorkerMeta({
    runId,
    controlTabId,
    controlWindowId,
    rootWindowId: workerWindowId,
    rootTabId: workerTabId,
    windowIds: [workerWindowId],
    tabIds: [workerTabId],
    openedAt: Date.now(),
    updatedAt: Date.now(),
  });

  const removable = oldWindowIds.filter((id) => id !== workerWindowId && id !== controlWindowId);
  if (removable.length) {
    setTimeout(() => void closeWindowIds(removable), 500);
  }

  return { ok: true, workerWindowId, workerTabId };
}

async function closeFreshWorkers(runId, sender, preserveSenderWindow = false) {
  const meta = await getWorkerMeta();
  if (!meta || meta.runId !== runId) return { ok: true, closed: 0 };
  const senderWindowId = sender?.tab?.windowId;
  const controlWindowId = meta.controlWindowId;
  const windowIds = (Array.isArray(meta.windowIds) ? meta.windowIds : [])
    .filter((id) => id !== controlWindowId)
    .filter((id) => !preserveSenderWindow || id !== senderWindowId);
  await setWorkerMeta({
    runId,
    controlTabId: meta.controlTabId,
    controlWindowId,
    rootWindowId: null,
    rootTabId: null,
    windowIds: preserveSenderWindow && Number.isInteger(senderWindowId) ? [senderWindowId] : [],
    tabIds: [],
    updatedAt: Date.now(),
  });
  if (windowIds.length) setTimeout(() => void closeWindowIds(windowIds), 350);
  return { ok: true, closed: windowIds.length };
}

async function adminReady(runId, sender) {
  const context = await recordWorkerContext(runId, sender, true);
  if (!context.worker) return { ok: false, error: "fresh_worker_admin_not_tracked" };
  const meta = await getWorkerMeta();
  const senderWindowId = sender?.tab?.windowId;
  const senderTabId = sender?.tab?.id;
  if (!meta || meta.runId !== runId) return { ok: false, error: "fresh_worker_meta_missing" };

  const oldRootWindowId = meta.rootWindowId;
  const windowIds = new Set(Array.isArray(meta.windowIds) ? meta.windowIds : []);
  const tabIds = new Set(Array.isArray(meta.tabIds) ? meta.tabIds : []);
  if (Number.isInteger(senderWindowId)) windowIds.add(senderWindowId);
  if (Number.isInteger(senderTabId)) tabIds.add(senderTabId);
  await setWorkerMeta({
    ...meta,
    rootWindowId: senderWindowId,
    rootTabId: senderTabId,
    windowIds: [...windowIds],
    tabIds: [...tabIds],
    updatedAt: Date.now(),
  });

  if (Number.isInteger(oldRootWindowId)
    && oldRootWindowId !== senderWindowId
    && oldRootWindowId !== meta.controlWindowId) {
    setTimeout(() => void closeWindowIds([oldRootWindowId]), 600);
  }
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const runId = text(message.runId);

  if (message.type === CLAIM_MESSAGE) {
    claimOneProduct(runId).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "fresh_worker_claim_exception",
      message: error instanceof Error ? error.message : String(error || "claim failed"),
    }));
    return true;
  }

  if (message.type === OPEN_WORKER_MESSAGE) {
    openFreshWorker(runId, sender).then(sendResponse).catch((error) => sendResponse({
      ok: false,
      error: "fresh_worker_open_exception",
      message: error instanceof Error ? error.message : String(error || "open failed"),
    }));
    return true;
  }

  if (message.type === CLOSE_WORKERS_MESSAGE) {
    closeFreshWorkers(runId, sender, Boolean(message.preserveSenderWindow))
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: "fresh_worker_close_exception", message: String(error || "close failed") }));
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
      message: error instanceof Error ? error.message : String(error || "admin ready failed"),
    }));
    return true;
  }

  if (message.type === ARM_MESSAGE) {
    void recordWorkerContext(runId, sender, true);
    api({ action: "arm-submit", runId, goodsKey: text(message.goodsKey) })
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: "fresh_worker_arm_exception", message: String(error || "arm failed") }));
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
      message: error instanceof Error ? error.message : String(error || "report failed"),
    }));
    return true;
  }

  return false;
});

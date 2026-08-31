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
const WORKER_META_KEY = "commerceOsShoplingFreshWorkerMetaV032";
const LAUNCHER_URL = "https://shopling.co.kr/index.php";
const POPUP_PATTERNS = ["https://shopling.co.kr/*", "https://*.shopling.co.kr/*"];
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

function isPersistentLauncherUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return /^(?:www\.)?shopling\.co\.kr$/i.test(parsed.hostname)
      && /\/index\.php$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isRecoverableLauncherUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return /^(?:www\.)?shopling\.co\.kr$/i.test(parsed.hostname)
      && /\/form\/login_proc\.php$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isAdminTabUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return /(?:^|\.)a\.shopling\.co\.kr$/i.test(parsed.hostname)
      || /(?:^|\.)api\d*\.shopling\.co\.kr$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

async function waitForTab(tabId, predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return null;
    if (predicate(tab)) return tab;
    await sleep(150);
  }
  return null;
}

async function restoreLauncherTab(tabId) {
  let tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return null;
  if (isPersistentLauncherUrl(tab.url)) return tab;
  if (!isRecoverableLauncherUrl(tab.url)) return null;
  await chrome.tabs.update(tabId, { url: LAUNCHER_URL }).catch(() => null);
  tab = await waitForTab(
    tabId,
    (candidate) => isPersistentLauncherUrl(candidate.url) && candidate.status === "complete",
    10000,
  );
  return tab;
}

async function findPersistentLauncherTab(controlTabId, preferredTabId = null) {
  if (Number.isInteger(preferredTabId)) {
    const preferred = await chrome.tabs.get(preferredTabId).catch(() => null);
    if (preferred && preferred.id !== controlTabId) {
      if (isPersistentLauncherUrl(preferred.url)) return preferred;
      if (isRecoverableLauncherUrl(preferred.url)) {
        const restored = await restoreLauncherTab(preferred.id);
        if (restored) return restored;
      }
    }
  }

  const tabs = await chrome.tabs.query({});
  const exact = tabs
    .filter((tab) => Number.isInteger(tab.id) && tab.id !== controlTabId && isPersistentLauncherUrl(tab.url))
    .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0));
  if (exact[0]) return exact[0];

  const recoverable = tabs
    .filter((tab) => Number.isInteger(tab.id) && tab.id !== controlTabId && isRecoverableLauncherUrl(tab.url))
    .sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)) || Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0));
  if (!recoverable[0]) return null;
  return restoreLauncherTab(recoverable[0].id);
}

function setPopupContentSetting(pattern, setting) {
  return new Promise((resolve) => {
    chrome.contentSettings.popups.set(
      { primaryPattern: pattern, setting, scope: "regular" },
      () => {
        const error = chrome.runtime.lastError;
        resolve(error ? { ok: false, message: error.message } : { ok: true });
      },
    );
  });
}

function clearPopupContentSettings() {
  return new Promise((resolve) => {
    chrome.contentSettings.popups.clear({ scope: "regular" }, () => {
      const error = chrome.runtime.lastError;
      resolve(error ? { ok: false, message: error.message } : { ok: true });
    });
  });
}

async function allowShoplingPopupsTemporarily() {
  for (const pattern of POPUP_PATTERNS) {
    const result = await setPopupContentSetting(pattern, "allow");
    if (!result.ok) {
      await clearPopupContentSettings();
      return result;
    }
  }
  return { ok: true };
}

async function clickManagerAccessOnLauncher(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        const normalize = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
        const label = (element) => normalize(
          element?.value || element?.innerText || element?.textContent || element?.getAttribute?.("aria-label") || "",
        );
        const all = [...document.querySelectorAll("a,button,input,[role='button'],[onclick],div,span")];
        const leaf = all.find((element) => /^관리자\s*접속$/i.test(label(element)))
          || all.find((element) => /관리자\s*접속/i.test(label(element)));
        if (!leaf) return { clicked: false, reason: "manager_access_text_missing" };
        const clickable = leaf.closest?.("a,button,[role='button'],[onclick]") || leaf;
        const form = clickable.form || clickable.closest?.("form") || null;
        const diagnostic = {
          tag: String(clickable.tagName || ""),
          href: String(clickable.getAttribute?.("href") || ""),
          onclick: String(clickable.getAttribute?.("onclick") || "").slice(0, 500),
          formAction: String(form?.action || ""),
          formMethod: String(form?.method || ""),
          formTarget: String(form?.target || ""),
        };
        try {
          clickable.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
          clickable.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        } catch {
          // Best effort.
        }
        if (typeof clickable.click === "function") clickable.click();
        else clickable.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return { clicked: true, label: label(clickable) || label(leaf), diagnostic };
      },
    });
    const successRow = Array.isArray(results) ? results.find((row) => row?.result?.clicked === true) : null;
    return successRow
      ? { ok: true, diagnostic: successRow.result?.diagnostic || null }
      : {
          ok: false,
          error: "persistent_launcher_manager_button_missing",
          message: "기존 로그인 Shopling 메인 탭에서 관리자접속 버튼을 찾지 못했습니다.",
        };
  } catch (error) {
    return {
      ok: false,
      error: "persistent_launcher_script_failed",
      message: error instanceof Error ? error.message : String(error || "launcher script failed"),
    };
  }
}

async function waitForAdminPopup(launcherTabId, launcherWindowId, beforeIds, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tabs = await chrome.tabs.query({});
    const created = tabs.filter((tab) => Number.isInteger(tab.id) && !beforeIds.has(tab.id));
    const byOpener = created.find((tab) => tab.openerTabId === launcherTabId);
    if (byOpener) return byOpener;
    const byAdminWindow = created.find((tab) => tab.windowId !== launcherWindowId && isAdminTabUrl(tab.url));
    if (byAdminWindow) return byAdminWindow;
    await sleep(150);
  }
  return null;
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
  const fromLauncher = Number.isInteger(openerTabId) && openerTabId === meta.launcherTabId;
  const fromWorker = Number.isInteger(openerTabId) && tabs.has(openerTabId);
  if (!worker && allowOpener && (fromLauncher || fromWorker)) {
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
  return { worker, control, launcher: tabId === meta.launcherTabId };
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

async function releaseRunBeforeSubmit(runId, reasonCode, message) {
  const result = await releaseApi(runId, reasonCode, message);
  return result?.ok ? result : { ok: false, error: result?.error || "release_failed", message: result?.message || "claim 원복 실패" };
}

async function openFreshWorker(runId, sender) {
  if (!validRunId(runId)) return { ok: false, error: "invalid_fresh_worker_run_id" };
  const previous = await getWorkerMeta();
  const sameRun = previous?.runId === runId;
  const oldWorkerWindowIds = sameRun && Array.isArray(previous.windowIds) ? [...previous.windowIds] : [];
  const controlTabId = sameRun && Number.isInteger(previous?.controlTabId)
    ? previous.controlTabId
    : (sender?.tab?.id ?? null);
  const controlWindowId = sameRun && Number.isInteger(previous?.controlWindowId)
    ? previous.controlWindowId
    : (sender?.tab?.windowId ?? null);

  const launcher = await findPersistentLauncherTab(
    controlTabId,
    sameRun && Number.isInteger(previous?.launcherTabId) ? previous.launcherTabId : null,
  );
  if (!launcher || !Number.isInteger(launcher.id) || !Number.isInteger(launcher.windowId)) {
    await releaseRunBeforeSubmit(
      runId,
      "persistent_shopling_launcher_missing",
      "로그인 Shopling 메인(index.php) 탭을 찾지 못해 송신 전에 claim을 원복했습니다.",
    );
    return {
      ok: false,
      error: "persistent_shopling_launcher_missing",
      message: "로그인해 둔 Shopling 메인(index.php) 탭을 찾지 못했습니다. 첫 번째 Shopling 메인 탭을 로그인 상태로 열어두세요.",
    };
  }

  const disposable = oldWorkerWindowIds.filter((id) => id !== controlWindowId && id !== launcher.windowId);
  if (disposable.length) await closeWindowIds(disposable);

  await setWorkerMeta({
    runId,
    controlTabId,
    controlWindowId,
    launcherTabId: launcher.id,
    launcherWindowId: launcher.windowId,
    rootWindowId: null,
    rootTabId: null,
    windowIds: [],
    tabIds: [],
    openedAt: Date.now(),
    updatedAt: Date.now(),
  });

  const popupPermission = await allowShoplingPopupsTemporarily();
  if (!popupPermission.ok) {
    await releaseRunBeforeSubmit(
      runId,
      "shopling_popup_permission_failed",
      "Shopling 팝업 허용을 설정하지 못해 송신 전에 claim을 원복했습니다.",
    );
    return {
      ok: false,
      error: "shopling_popup_permission_failed",
      message: text(popupPermission.message),
    };
  }

  const beforeTabs = await chrome.tabs.query({});
  const beforeIds = new Set(beforeTabs.map((tab) => tab.id).filter(Number.isInteger));
  const clickResult = await clickManagerAccessOnLauncher(launcher.id);
  if (!clickResult?.ok) {
    await clearPopupContentSettings();
    await restoreLauncherTab(launcher.id);
    await releaseRunBeforeSubmit(
      runId,
      clickResult?.error || "persistent_launcher_click_failed",
      `관리자접속 실행 실패로 송신 전에 claim을 원복했습니다. ${text(clickResult?.message)}`,
    );
    return clickResult;
  }

  const popup = await waitForAdminPopup(launcher.id, launcher.windowId, beforeIds, 8000);
  await clearPopupContentSettings();
  await sleep(350);
  await restoreLauncherTab(launcher.id);

  if (!popup || !Number.isInteger(popup.id) || !Number.isInteger(popup.windowId)) {
    const diagnostic = clickResult?.diagnostic || null;
    await releaseRunBeforeSubmit(
      runId,
      "persistent_launcher_admin_popup_missing",
      "관리자접속 실행 후 새 관리자 팝업이 확인되지 않아 송신 전에 claim을 원복했습니다.",
    );
    return {
      ok: false,
      error: "persistent_launcher_admin_popup_missing",
      message: "관리자접속은 실행됐지만 새 관리자 창이 확인되지 않았습니다. 런처 탭은 index.php로 복구했습니다.",
      diagnostic,
    };
  }

  await setWorkerMeta({
    runId,
    controlTabId,
    controlWindowId,
    launcherTabId: launcher.id,
    launcherWindowId: launcher.windowId,
    rootWindowId: popup.windowId,
    rootTabId: popup.id,
    windowIds: [popup.windowId],
    tabIds: [popup.id],
    openedAt: Date.now(),
    updatedAt: Date.now(),
  });

  return {
    ok: true,
    launcherTabId: launcher.id,
    launcherWindowId: launcher.windowId,
    workerWindowId: popup.windowId,
    workerTabId: popup.id,
    adminPopupVerified: true,
  };
}

async function closeFreshWorkers(runId, sender, preserveSender = false) {
  const meta = await getWorkerMeta();
  if (!meta || meta.runId !== runId) return { ok: true, closed: 0 };
  const senderWindowId = sender?.tab?.windowId;
  const ids = (Array.isArray(meta.windowIds) ? meta.windowIds : [])
    .filter((id) => id !== meta.controlWindowId && id !== meta.launcherWindowId)
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

chrome.runtime.onInstalled.addListener(() => {
  void clearPopupContentSettings();
});

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

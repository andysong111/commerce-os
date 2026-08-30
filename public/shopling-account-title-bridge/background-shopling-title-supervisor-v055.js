"use strict";

const TITLE_SUPERVISOR_ALARM = "commerce-os-shopling-title-supervisor-v055";
const TITLE_RUN_KEY_V055 = "commerceOsShoplingTitleBatchRun";
const TITLE_LAST_RUN_KEY_V055 = "commerceOsShoplingTitleBatchLastRun";
const TITLE_HEARTBEAT_KEY_V055 = "commerceOsShoplingTitleBatchSupervisorHeartbeat";
const TITLE_STALE_MS_V055 = 75000;
const TITLE_MAX_RECOVERY_ATTEMPTS_V055 = 2;

function titleSupervisorText(value) {
  return String(value ?? "").trim();
}

function titleSupervisorSignature(run) {
  if (!run || typeof run !== "object") return "";
  return JSON.stringify({
    runId: titleSupervisorText(run.runId),
    index: Number(run.index || 0),
    done: Number(run.done || 0),
    currentGoodsKey: titleSupervisorText(run.currentGoodsKey),
    currentTabId: Number.isInteger(run.currentTabId) ? run.currentTabId : null,
    currentAttempt: Number(run.currentAttempt || 0),
    phase: titleSupervisorText(run.phase),
    status: titleSupervisorText(run.status),
  });
}

async function titleSupervisorLoadRun() {
  const stored = await chrome.storage.session.get(TITLE_RUN_KEY_V055);
  return stored?.[TITLE_RUN_KEY_V055] || null;
}

async function titleSupervisorSaveRun(run) {
  if (!run) {
    await chrome.storage.session.remove(TITLE_RUN_KEY_V055);
    return;
  }
  await chrome.storage.session.set({ [TITLE_RUN_KEY_V055]: run });
}

async function titleSupervisorHeartbeat(run) {
  if (!run || titleSupervisorText(run.status) !== "running") return;
  await chrome.storage.local.set({
    [TITLE_HEARTBEAT_KEY_V055]: {
      runId: titleSupervisorText(run.runId),
      signature: titleSupervisorSignature(run),
      at: Date.now(),
    },
  });
}

async function titleSupervisorSafeRemoveTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Already closed or unavailable.
  }
}

function titleSupervisorBatchUrl(goodsKey, runId, attempt) {
  const url = new URL("https://a.shopling.co.kr/prod/prodShopInfo.phtml");
  url.searchParams.set("mode", "nm_chg");
  url.searchParams.set("prod_id", goodsKey);
  url.searchParams.set("commerce_os_batch", "1");
  url.searchParams.set("commerce_os_run", runId);
  url.searchParams.set("commerce_os_attempt", String(attempt || 0));
  return url.href;
}

function titleSupervisorVerifyUrl(goodsKey, runId, attempt) {
  const url = new URL("https://a.shopling.co.kr/prod/prodShopInfo.phtml");
  url.searchParams.set("mode", "nm_chg");
  url.searchParams.set("prod_id", goodsKey);
  url.searchParams.set("commerce_os_verify", "1");
  url.searchParams.set("commerce_os_run", runId);
  url.searchParams.set("commerce_os_attempt", String(attempt || 0));
  return url.href;
}

async function titleSupervisorNotify(run, extra = {}) {
  if (!Number.isInteger(run?.originTabId)) return;
  try {
    await chrome.tabs.sendMessage(run.originTabId, {
      type: "commerce-os-shopling-title-batch-progress",
      status: run.status,
      total: Array.isArray(run.goodsKeys) ? run.goodsKeys.length : 0,
      done: Number(run.done || 0),
      changed: Number(run.changed || 0),
      autoRecovered: Number(run.autoRecovered || 0),
      skipped: Number(run.skipped || 0),
      failed: Number(run.failed || 0),
      retryCount: Number(run.retryCount || 0),
      goodsKey: titleSupervisorText(run.currentGoodsKey),
      currentAttempt: Number(run.currentAttempt || 0),
      failures: Array.isArray(run.failures) ? run.failures : [],
      supervisor: true,
      ...extra,
    });
  } catch {
    // Origin UI is optional. Durable extension state remains authoritative.
  }
}

async function titleSupervisorSaveLastRun(run) {
  await chrome.storage.local.set({
    [TITLE_LAST_RUN_KEY_V055]: {
      runId: run.runId,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt || new Date().toISOString(),
      total: Array.isArray(run.goodsKeys) ? run.goodsKeys.length : 0,
      done: Number(run.done || 0),
      changed: Number(run.changed || 0),
      autoRecovered: Number(run.autoRecovered || 0),
      skipped: Number(run.skipped || 0),
      failed: Number(run.failed || 0),
      retryCount: Number(run.retryCount || 0),
      failures: Array.isArray(run.failures) ? run.failures : [],
      itemResults: Array.isArray(run.itemResults) ? run.itemResults : [],
    },
  });
}

async function titleSupervisorFinishRun(run) {
  run.status = "completed";
  run.finishedAt = new Date().toISOString();
  run.currentGoodsKey = "";
  run.currentTabId = null;
  run.phase = "completed";
  await titleSupervisorSaveRun(run);
  await titleSupervisorSaveLastRun(run);
  await titleSupervisorNotify(run, { supervisorCompleted: true });
  await titleSupervisorSaveRun(null);
}

async function titleSupervisorOpen(run, mode) {
  const goodsKey = titleSupervisorText(run.currentGoodsKey);
  if (!/^\d{5,9}$/.test(goodsKey)) throw new Error("invalid_supervisor_goods_key");
  const attempt = Number(run.currentAttempt || 0);
  const url = mode === "verify"
    ? titleSupervisorVerifyUrl(goodsKey, run.runId, attempt)
    : titleSupervisorBatchUrl(goodsKey, run.runId, attempt);
  const tab = await chrome.tabs.create({ url, active: false });
  run.currentTabId = tab.id ?? null;
  run.phase = mode;
  run.supervisorRecoveredAt = new Date().toISOString();
  await titleSupervisorSaveRun(run);
  await titleSupervisorHeartbeat(run);
  await titleSupervisorNotify(run, {
    retrying: true,
    reasonCode: "supervisor_recovered_stall",
    retryMessage: `${goodsKey} ${mode} 작업을 백그라운드 감시기가 복구했습니다.`,
  });
}

async function titleSupervisorAdvanceFailed(run, reasonCode, message) {
  const goodsKey = titleSupervisorText(run.currentGoodsKey);
  const attempts = Number(run.currentAttempt || 0) + 1;
  run.failed = Number(run.failed || 0) + 1;
  run.done = Number(run.done || 0) + 1;
  run.index = Number(run.index || 0) + 1;
  run.failures = Array.isArray(run.failures) ? run.failures : [];
  run.itemResults = Array.isArray(run.itemResults) ? run.itemResults : [];
  run.failures.push({
    goodsKey,
    reasonCode,
    message,
    attempts,
    at: new Date().toISOString(),
    supervisor: true,
  });
  run.itemResults.push({
    goodsKey,
    outcome: "failed",
    attempts,
    recovered: false,
    usedVerifiedPool: Boolean(run.currentUsedFallback),
    changedCount: Number(run.currentChangedCount || 0),
    reasonCode,
    message,
    finishedAt: new Date().toISOString(),
    supervisor: true,
  });
  run.currentTabId = null;
  run.currentAttempt = 0;
  run.currentUsedFallback = false;
  run.currentHadMutation = false;
  run.currentChangedCount = 0;

  if (run.index >= (Array.isArray(run.goodsKeys) ? run.goodsKeys.length : 0)) {
    await titleSupervisorFinishRun(run);
    return;
  }

  run.currentGoodsKey = titleSupervisorText(run.goodsKeys[run.index]);
  run.phase = "opening";
  await titleSupervisorSaveRun(run);
  await titleSupervisorHeartbeat(run);
  await titleSupervisorOpen(run, "batch");
}

async function titleSupervisorRecover(run) {
  const goodsKeys = Array.isArray(run.goodsKeys) ? run.goodsKeys : [];
  if (!goodsKeys.length) return;
  if (Number(run.index || 0) >= goodsKeys.length) {
    await titleSupervisorFinishRun(run);
    return;
  }

  if (!/^\d{5,9}$/.test(titleSupervisorText(run.currentGoodsKey))) {
    run.currentGoodsKey = titleSupervisorText(goodsKeys[Number(run.index || 0)]);
    run.currentAttempt = Number(run.currentAttempt || 0);
    run.phase = "opening";
  }

  const oldTabId = Number.isInteger(run.currentTabId) ? run.currentTabId : null;
  await titleSupervisorSafeRemoveTab(oldTabId);
  run.currentTabId = null;

  const phase = titleSupervisorText(run.phase);
  const verificationSafe = ["saving", "verify-opening", "verify"].includes(phase);
  const nextAttempt = Number(run.currentAttempt || 0) + 1;
  run.retryCount = Number(run.retryCount || 0) + 1;

  if (nextAttempt > TITLE_MAX_RECOVERY_ATTEMPTS_V055) {
    await titleSupervisorAdvanceFailed(
      run,
      "background_supervisor_timeout",
      `${run.currentGoodsKey} 작업이 반복 중단되어 해당 상품만 실패 처리하고 다음 상품으로 진행합니다.`,
    );
    return;
  }

  run.currentAttempt = nextAttempt;
  run.phase = verificationSafe ? "verify-opening" : "retrying";
  await titleSupervisorSaveRun(run);
  await titleSupervisorHeartbeat(run);
  await titleSupervisorOpen(run, verificationSafe ? "verify" : "batch");
}

async function titleSupervisorTick() {
  const run = await titleSupervisorLoadRun();
  if (!run || titleSupervisorText(run.status) !== "running") return;

  const signature = titleSupervisorSignature(run);
  const stored = await chrome.storage.local.get(TITLE_HEARTBEAT_KEY_V055);
  const heartbeat = stored?.[TITLE_HEARTBEAT_KEY_V055] || null;
  const now = Date.now();

  if (
    !heartbeat ||
    titleSupervisorText(heartbeat.runId) !== titleSupervisorText(run.runId) ||
    titleSupervisorText(heartbeat.signature) !== signature
  ) {
    await titleSupervisorHeartbeat(run);
    return;
  }

  const at = Number(heartbeat.at || 0);
  if (!Number.isFinite(at) || now - at < TITLE_STALE_MS_V055) return;
  await titleSupervisorRecover(run);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "session" || !changes[TITLE_RUN_KEY_V055]?.newValue) return;
  const run = changes[TITLE_RUN_KEY_V055].newValue;
  if (titleSupervisorText(run?.status) === "running") void titleSupervisorHeartbeat(run);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== TITLE_SUPERVISOR_ALARM) return;
  void titleSupervisorTick();
});

chrome.alarms.create(TITLE_SUPERVISOR_ALARM, { periodInMinutes: 1 });
void titleSupervisorTick();

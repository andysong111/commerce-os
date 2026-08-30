"use strict";

const BATCH_START_MESSAGE = "commerce-os-shopling-title-batch-start";
const BATCH_PAGE_MESSAGE = "commerce-os-shopling-title-batch-page";
const BATCH_PROGRESS_MESSAGE = "commerce-os-shopling-title-batch-progress";
const RUN_STORAGE_KEY = "commerceOsShoplingTitleBatchRun";
const PAGE_TIMEOUT_MS = 30000;
const SAVE_SETTLE_MS = 1800;
const MAX_BATCH_GOODS_KEYS = 500;

function uniqueGoodsKeys(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter((value) => /^\d{5,9}$/.test(value)))]
    .slice(0, MAX_BATCH_GOODS_KEYS);
}

function makeRunId() {
  return `shopling-title-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function loadRun() {
  const stored = await chrome.storage.session.get(RUN_STORAGE_KEY);
  return stored?.[RUN_STORAGE_KEY] || null;
}

async function saveRun(run) {
  if (!run) {
    await chrome.storage.session.remove(RUN_STORAGE_KEY);
    return;
  }
  await chrome.storage.session.set({ [RUN_STORAGE_KEY]: run });
}

async function safeRemoveTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // The Shopling popup may close itself after saving.
  }
}

async function notifyOrigin(run, extra = {}) {
  if (!run || !Number.isInteger(run.originTabId)) return;
  const payload = {
    type: BATCH_PROGRESS_MESSAGE,
    status: run.status,
    total: run.goodsKeys.length,
    done: run.done,
    changed: run.changed,
    skipped: run.skipped,
    failed: run.failed,
    goodsKey: run.currentGoodsKey || "",
    ...extra,
  };
  try {
    await chrome.tabs.sendMessage(run.originTabId, payload);
  } catch {
    // The origin Shopling list tab may have been closed; the batch can still finish.
  }
}

function batchUrl(goodsKey, runId) {
  const url = new URL("https://a.shopling.co.kr/prod/prodShopInfo.phtml");
  url.searchParams.set("mode", "nm_chg");
  url.searchParams.set("prod_id", goodsKey);
  url.searchParams.set("commerce_os_batch", "1");
  url.searchParams.set("commerce_os_run", runId);
  return url.href;
}

function verifyUrl(goodsKey, runId) {
  const url = new URL("https://a.shopling.co.kr/prod/prodShopInfo.phtml");
  url.searchParams.set("mode", "nm_chg");
  url.searchParams.set("prod_id", goodsKey);
  url.searchParams.set("commerce_os_verify", "1");
  url.searchParams.set("commerce_os_run", runId);
  return url.href;
}

async function finishRun(run) {
  run.status = "completed";
  run.currentGoodsKey = "";
  run.currentTabId = null;
  run.phase = "completed";
  await saveRun(run);
  await notifyOrigin(run);
  await saveRun(null);
}

function armWatchdog(runId, goodsKey, phase) {
  setTimeout(async () => {
    const run = await loadRun();
    if (!run || run.runId !== runId || run.status !== "running") return;
    if (run.currentGoodsKey !== goodsKey || run.phase !== phase) return;
    await safeRemoveTab(run.currentTabId);
    run.failed += 1;
    run.done += 1;
    run.index += 1;
    run.phase = "timeout";
    run.lastError = `${goodsKey} ${phase} timeout`;
    await saveRun(run);
    await notifyOrigin(run);
    await processNext();
  }, PAGE_TIMEOUT_MS);
}

async function openBatchPage(run) {
  const goodsKey = run.currentGoodsKey;
  const tab = await chrome.tabs.create({
    url: batchUrl(goodsKey, run.runId),
    active: false,
  });
  run.currentTabId = tab.id ?? null;
  run.phase = "batch";
  await saveRun(run);
  await notifyOrigin(run);
  armWatchdog(run.runId, goodsKey, "batch");
}

async function openVerifyPage(run, previousTabId) {
  const current = await loadRun();
  if (!current || current.runId !== run.runId || current.status !== "running") return;
  if (current.currentGoodsKey !== run.currentGoodsKey || current.phase !== "saving") return;

  current.phase = "verify-opening";
  await saveRun(current);
  await safeRemoveTab(previousTabId);

  const tab = await chrome.tabs.create({
    url: verifyUrl(current.currentGoodsKey, current.runId),
    active: false,
  });
  current.currentTabId = tab.id ?? null;
  current.phase = "verify";
  await saveRun(current);
  await notifyOrigin(current);
  armWatchdog(current.runId, current.currentGoodsKey, "verify");
}

async function processNext() {
  const run = await loadRun();
  if (!run || run.status !== "running") return;
  if (run.index >= run.goodsKeys.length) {
    await finishRun(run);
    return;
  }

  run.currentGoodsKey = run.goodsKeys[run.index];
  run.currentTabId = null;
  run.phase = "opening";
  await saveRun(run);
  await notifyOrigin(run);

  try {
    await openBatchPage(run);
  } catch (error) {
    run.failed += 1;
    run.done += 1;
    run.index += 1;
    run.phase = "open-failed";
    run.lastError = error instanceof Error ? error.message : String(error || "open failed");
    await saveRun(run);
    await notifyOrigin(run);
    await processNext();
  }
}

async function startBatch(goodsKeys, originTabId) {
  const existing = await loadRun();
  if (existing?.status === "running") {
    return { ok: false, message: "이미 Shopling 상품명 일괄 처리가 진행 중입니다." };
  }

  const normalized = uniqueGoodsKeys(goodsKeys);
  if (!normalized.length) {
    return { ok: false, message: "처리할 goods key가 없습니다." };
  }

  const run = {
    runId: makeRunId(),
    originTabId,
    goodsKeys: normalized,
    index: 0,
    done: 0,
    changed: 0,
    skipped: 0,
    failed: 0,
    currentGoodsKey: "",
    currentTabId: null,
    phase: "queued",
    status: "running",
    startedAt: new Date().toISOString(),
    lastError: "",
  };
  await saveRun(run);
  void processNext();
  return { ok: true, runId: run.runId, total: normalized.length };
}

async function completeCurrent({ outcome, tabId, message = "" }) {
  const run = await loadRun();
  if (!run || run.status !== "running") return;
  await safeRemoveTab(tabId);

  if (outcome === "changed") run.changed += 1;
  else if (outcome === "skipped") run.skipped += 1;
  else run.failed += 1;

  run.done += 1;
  run.index += 1;
  run.phase = "item-complete";
  if (message) run.lastError = message;
  await saveRun(run);
  await notifyOrigin(run);
  await processNext();
}

async function handlePageMessage(message, sender) {
  const run = await loadRun();
  if (!run || run.status !== "running") return;
  if (message.runId !== run.runId || message.goodsKey !== run.currentGoodsKey) return;
  const tabId = sender.tab?.id;

  if (message.phase === "noop") {
    await completeCurrent({ outcome: "skipped", tabId });
    return;
  }

  if (message.phase === "unresolved" || message.phase === "failure") {
    await completeCurrent({
      outcome: "failed",
      tabId,
      message: message.message || `${message.goodsKey} 상품명 분산 확인 필요`,
    });
    return;
  }

  if (message.phase === "saving") {
    if (run.phase !== "batch") return;
    run.phase = "saving";
    run.currentTabId = tabId ?? run.currentTabId;
    await saveRun(run);
    await notifyOrigin(run);
    setTimeout(() => {
      void openVerifyPage(run, tabId);
    }, SAVE_SETTLE_MS);
    return;
  }

  if (message.phase === "verify") {
    if (run.phase !== "verify") return;
    await completeCurrent({
      outcome: message.success ? "changed" : "failed",
      tabId,
      message: message.success
        ? ""
        : `${message.goodsKey} 저장 후 동일 쇼핑몰 중복 ${message.duplicateGroupCount || 0}그룹 잔존`,
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === BATCH_START_MESSAGE) {
    startBatch(message.goodsKeys, sender.tab?.id)
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        message: error instanceof Error ? error.message : String(error || "batch start failed"),
      }));
    return true;
  }

  if (message.type === BATCH_PAGE_MESSAGE) {
    handlePageMessage(message, sender)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({
        ok: false,
        message: error instanceof Error ? error.message : String(error || "batch page failed"),
      }));
    return true;
  }

  return false;
});

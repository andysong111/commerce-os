"use strict";

const BATCH_START_MESSAGE = "commerce-os-shopling-title-batch-start";
const BATCH_PAGE_MESSAGE = "commerce-os-shopling-title-batch-page";
const BATCH_PROGRESS_MESSAGE = "commerce-os-shopling-title-batch-progress";
const RUN_STORAGE_KEY = "commerceOsShoplingTitleBatchRun";
const LAST_RUN_STORAGE_KEY = "commerceOsShoplingTitleBatchLastRun";
const PAGE_TIMEOUT_MS = 60000;
const SAVE_VERIFY_FALLBACK_MS = 4500;
const MAX_BATCH_GOODS_KEYS = 500;
const MAX_AUTO_RETRIES = 2;

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

async function saveLastRun(run) {
  const snapshot = {
    runId: run.runId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt || new Date().toISOString(),
    total: run.goodsKeys.length,
    done: run.done,
    changed: run.changed,
    autoRecovered: run.autoRecovered,
    skipped: run.skipped,
    failed: run.failed,
    retryCount: run.retryCount,
    failures: run.failures,
    itemResults: run.itemResults,
  };
  await chrome.storage.local.set({ [LAST_RUN_STORAGE_KEY]: snapshot });
}

async function safeRemoveTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Shopling may close its own save tab.
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
    autoRecovered: run.autoRecovered,
    skipped: run.skipped,
    failed: run.failed,
    retryCount: run.retryCount,
    goodsKey: run.currentGoodsKey || "",
    currentAttempt: Number(run.currentAttempt || 0),
    failures: run.failures,
    ...extra,
  };
  try {
    await chrome.tabs.sendMessage(run.originTabId, payload);
  } catch {
    // Closing the list tab must not corrupt the batch state.
  }
}

function batchUrl(goodsKey, runId, attempt) {
  const url = new URL("https://a.shopling.co.kr/prod/prodShopInfo.phtml");
  url.searchParams.set("mode", "nm_chg");
  url.searchParams.set("prod_id", goodsKey);
  url.searchParams.set("commerce_os_batch", "1");
  url.searchParams.set("commerce_os_run", runId);
  url.searchParams.set("commerce_os_attempt", String(attempt || 0));
  return url.href;
}

function verifyUrl(goodsKey, runId, attempt) {
  const url = new URL("https://a.shopling.co.kr/prod/prodShopInfo.phtml");
  url.searchParams.set("mode", "nm_chg");
  url.searchParams.set("prod_id", goodsKey);
  url.searchParams.set("commerce_os_verify", "1");
  url.searchParams.set("commerce_os_run", runId);
  url.searchParams.set("commerce_os_attempt", String(attempt || 0));
  return url.href;
}

async function finishRun(run) {
  run.status = "completed";
  run.finishedAt = new Date().toISOString();
  run.currentGoodsKey = "";
  run.currentTabId = null;
  run.phase = "completed";
  await saveRun(run);
  await saveLastRun(run);
  await notifyOrigin(run, { failures: run.failures });
  await saveRun(null);
}

function makeFailure(goodsKey, reasonCode, message, run, detail = {}) {
  return {
    goodsKey,
    reasonCode: reasonCode || "unknown",
    message: message || "확인 필요",
    attempts: Number(run.currentAttempt || 0) + 1,
    at: new Date().toISOString(),
    ...detail,
  };
}

function armWatchdog(runId, goodsKey, phase, attempt) {
  setTimeout(async () => {
    const run = await loadRun();
    if (!run || run.runId !== runId || run.status !== "running") return;
    if (
      run.currentGoodsKey !== goodsKey ||
      run.phase !== phase ||
      Number(run.currentAttempt || 0) !== Number(attempt || 0)
    ) return;

    const tabId = run.currentTabId;
    const reasonCode = phase === "verify" ? "verify_timeout" : "batch_timeout";
    const message = `${goodsKey} ${phase} 단계가 ${PAGE_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다.`;
    await retryOrFailCurrent(run, {
      tabId,
      reasonCode,
      message,
      detail: { phase },
    });
  }, PAGE_TIMEOUT_MS);
}

async function openBatchPage(run) {
  const goodsKey = run.currentGoodsKey;
  const attempt = Number(run.currentAttempt || 0);
  const tab = await chrome.tabs.create({
    url: batchUrl(goodsKey, run.runId, attempt),
    active: false,
  });
  run.currentTabId = tab.id ?? null;
  run.phase = "batch";
  await saveRun(run);
  await notifyOrigin(run);
  armWatchdog(run.runId, goodsKey, "batch", attempt);
}

async function openVerifyPage(runInput, previousTabId) {
  const current = await loadRun();
  if (!current || current.runId !== runInput.runId || current.status !== "running") return;
  if (current.currentGoodsKey !== runInput.currentGoodsKey || current.phase !== "saving") return;

  current.phase = "verify-opening";
  current.currentTabId = null;
  await saveRun(current);
  await safeRemoveTab(previousTabId);

  const attempt = Number(current.currentAttempt || 0);
  const tab = await chrome.tabs.create({
    url: verifyUrl(current.currentGoodsKey, current.runId, attempt),
    active: false,
  });
  current.currentTabId = tab.id ?? null;
  current.phase = "verify";
  await saveRun(current);
  await notifyOrigin(current);
  armWatchdog(current.runId, current.currentGoodsKey, "verify", attempt);
}

function scheduleVerifyFallback(run) {
  setTimeout(() => {
    void openVerifyPage(run, run.currentTabId);
  }, SAVE_VERIFY_FALLBACK_MS);
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
  run.currentAttempt = 0;
  run.currentUsedFallback = false;
  run.currentHadMutation = false;
  run.currentChangedCount = 0;
  run.phase = "opening";
  await saveRun(run);
  await notifyOrigin(run);

  try {
    await openBatchPage(run);
  } catch (error) {
    await retryOrFailCurrent(run, {
      tabId: null,
      reasonCode: "open_failed",
      message: error instanceof Error ? error.message : String(error || "Shopling 작업 페이지 열기 실패"),
    });
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
    autoRecovered: 0,
    skipped: 0,
    failed: 0,
    retryCount: 0,
    failures: [],
    itemResults: [],
    currentGoodsKey: "",
    currentTabId: null,
    currentAttempt: 0,
    currentUsedFallback: false,
    currentHadMutation: false,
    currentChangedCount: 0,
    phase: "queued",
    status: "running",
    startedAt: new Date().toISOString(),
    lastError: "",
  };
  await chrome.storage.local.remove(LAST_RUN_STORAGE_KEY);
  await saveRun(run);
  await processNext();
  return { ok: true, runId: run.runId, total: normalized.length };
}

async function completeCurrent({ outcome, tabId, reasonCode = "", message = "", detail = {} }) {
  const run = await loadRun();
  if (!run || run.status !== "running") return;

  const goodsKey = run.currentGoodsKey;
  const attempts = Number(run.currentAttempt || 0) + 1;
  const recovered = outcome === "changed" && (
    Number(run.currentAttempt || 0) > 0 || Boolean(run.currentUsedFallback)
  );

  run.phase = "item-cleanup";
  run.currentTabId = null;
  await saveRun(run);
  await safeRemoveTab(tabId);

  if (outcome === "changed") {
    run.changed += 1;
    if (recovered) run.autoRecovered += 1;
  } else if (outcome === "skipped") {
    run.skipped += 1;
  } else {
    run.failed += 1;
    const failure = makeFailure(goodsKey, reasonCode, message, run, detail);
    run.failures.push(failure);
  }

  run.itemResults.push({
    goodsKey,
    outcome,
    attempts,
    recovered,
    usedVerifiedPool: Boolean(run.currentUsedFallback),
    changedCount: Number(run.currentChangedCount || 0),
    reasonCode,
    message,
    finishedAt: new Date().toISOString(),
    ...detail,
  });

  run.done += 1;
  run.index += 1;
  run.phase = "item-complete";
  if (message) run.lastError = message;
  await saveRun(run);
  await notifyOrigin(run);
  await processNext();
}

async function retryOrFailCurrent(runInput, {
  tabId,
  reasonCode,
  message,
  detail = {},
}) {
  const run = await loadRun();
  if (!run || run.status !== "running" || run.runId !== runInput.runId) return;
  if (run.currentGoodsKey !== runInput.currentGoodsKey) return;

  await safeRemoveTab(tabId ?? run.currentTabId);
  run.currentTabId = null;
  run.lastError = message;

  if (Number(run.currentAttempt || 0) < MAX_AUTO_RETRIES) {
    run.currentAttempt = Number(run.currentAttempt || 0) + 1;
    run.retryCount += 1;
    run.phase = "retrying";
    await saveRun(run);
    await notifyOrigin(run, {
      retrying: true,
      reasonCode,
      retryMessage: message,
    });
    try {
      await openBatchPage(run);
    } catch (error) {
      await retryOrFailCurrent(run, {
        tabId: null,
        reasonCode: "open_failed",
        message: error instanceof Error ? error.message : String(error || "재시도 페이지 열기 실패"),
        detail,
      });
    }
    return;
  }

  await completeCurrent({
    outcome: "failed",
    tabId: null,
    reasonCode,
    message,
    detail,
  });
}

async function handlePageMessage(message, sender) {
  const run = await loadRun();
  if (!run || run.status !== "running") return;
  if (message.runId !== run.runId || message.goodsKey !== run.currentGoodsKey) return;
  const tabId = sender.tab?.id;

  if (message.phase === "noop") {
    await completeCurrent({
      outcome: run.currentHadMutation ? "changed" : "skipped",
      tabId,
    });
    return;
  }

  if (message.phase === "unresolved" || message.phase === "failure") {
    await retryOrFailCurrent(run, {
      tabId,
      reasonCode: message.reasonCode || (message.phase === "unresolved" ? "keyword_pool_insufficient" : "worker_failure"),
      message: message.message || `${message.goodsKey} 상품명 분산 확인 필요`,
      detail: {
        duplicateGroupCount: Number(message.duplicateGroupCount || 0),
        duplicateMarkets: Array.isArray(message.duplicateMarkets) ? message.duplicateMarkets : [],
        verifiedPoolSize: Number(message.verifiedPoolSize || 0),
      },
    });
    return;
  }

  if (message.phase === "saving") {
    if (run.phase !== "batch") return;
    run.phase = "saving";
    run.currentTabId = tabId ?? run.currentTabId;
    run.currentHadMutation = true;
    run.currentChangedCount = Math.max(
      Number(run.currentChangedCount || 0),
      Number(message.changed || 0),
    );
    run.currentUsedFallback = Boolean(run.currentUsedFallback) || Number(message.fallbackUsed || 0) > 0;
    await saveRun(run);
    await notifyOrigin(run);
    scheduleVerifyFallback(run);
    return;
  }

  if (message.phase === "verify") {
    if (run.phase !== "verify") return;
    if (message.success) {
      await completeCurrent({ outcome: "changed", tabId });
      return;
    }
    await retryOrFailCurrent(run, {
      tabId,
      reasonCode: "save_verify_duplicate",
      message: `${message.goodsKey} 저장 후 동일 쇼핑몰 중복 ${message.duplicateGroupCount || 0}그룹이 남았습니다.`,
      detail: {
        duplicateGroupCount: Number(message.duplicateGroupCount || 0),
        duplicateMarkets: Array.isArray(message.duplicateMarkets) ? message.duplicateMarkets : [],
      },
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  void (async () => {
    const run = await loadRun();
    if (!run || run.status !== "running") return;
    if (run.phase !== "saving" || run.currentTabId !== tabId) return;
    await openVerifyPage(run, tabId);
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const run = await loadRun();
    if (!run || run.status !== "running") return;
    if (run.phase !== "saving" || run.currentTabId !== tabId) return;
    await openVerifyPage(run, null);
  })();
});

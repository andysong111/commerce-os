"use strict";

const SHOPLING_PRICE_READBACK_BRIDGE = "price-readback-v1";
const SHOPLING_PRICE_READBACK_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-price-readback-bridge";
const SHOPLING_PRICE_READBACK_PAGE_MESSAGE = "commerce-os-shopling-price-readback-page-result";
const SHOPLING_PRICE_READBACK_ALARM = "commerce-os-shopling-price-readback-worker";
const SHOPLING_PRICE_READBACK_RUN_KEY = "commerceOsShoplingPriceReadbackRun";
const SHOPLING_PRICE_READBACK_TIMEOUT_MS = 75 * 1000;
const SHOPLING_PRICE_READBACK_MAX_ATTEMPTS = 2;

function priceReadbackText(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function priceReadbackRunId() {
  return `shopling-price-readback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function priceReadbackPost(payload, timeoutMs = 15000) {
  try {
    const response = await fetch(SHOPLING_PRICE_READBACK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ bridge: SHOPLING_PRICE_READBACK_BRIDGE, ...payload }),
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) {
      return {
        ok: false,
        error: priceReadbackText(body?.error || `price_readback_http_${response.status}`),
        message: priceReadbackText(body?.message || body?.error || `price_readback_http_${response.status}`),
      };
    }
    return body;
  } catch (error) {
    return {
      ok: false,
      error: "price_readback_network_error",
      message: error instanceof Error ? error.message : String(error || "price readback request failed"),
    };
  }
}

async function priceReadbackLoadRun() {
  try {
    const stored = await chrome.storage.local.get(SHOPLING_PRICE_READBACK_RUN_KEY);
    return stored?.[SHOPLING_PRICE_READBACK_RUN_KEY] || null;
  } catch {
    return null;
  }
}

async function priceReadbackSaveRun(run) {
  try {
    if (!run) await chrome.storage.local.remove(SHOPLING_PRICE_READBACK_RUN_KEY);
    else await chrome.storage.local.set({ [SHOPLING_PRICE_READBACK_RUN_KEY]: run });
  } catch {
    // Server task state remains authoritative.
  }
}

async function priceReadbackCloseTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch {
    // Shopling may close or replace the tab itself.
  }
}

async function priceReadbackOtherWorkerBusy() {
  try {
    const [session, local] = await Promise.all([
      chrome.storage.session.get([
        "commerceOsShoplingTitleBatchRun",
        "commerceOsShoplingPipelineMarketRun",
        "commerceOsShoplingPipelineUiRun",
      ]),
      chrome.storage.local.get(["commerceOsShoplingLifecycleExecutorRun"]),
    ]);
    return Boolean(
      session?.commerceOsShoplingTitleBatchRun?.status === "running" ||
      session?.commerceOsShoplingPipelineMarketRun?.status === "running" ||
      session?.commerceOsShoplingPipelineUiRun?.status === "running" ||
      local?.commerceOsShoplingLifecycleExecutorRun,
    );
  } catch {
    return false;
  }
}

function priceReadbackPageUrl(task, runId, attempt) {
  const url = new URL("https://a.shopling.co.kr/prod/prodShopInfo.phtml");
  url.searchParams.set("mode", "price_chg");
  url.searchParams.set("prod_id", priceReadbackText(task.goodsKey));
  url.searchParams.set("commerce_os_price_readback", "1");
  url.searchParams.set("commerce_os_readback_run", runId);
  url.searchParams.set("commerce_os_readback_task", priceReadbackText(task.taskId));
  url.searchParams.set("commerce_os_readback_attempt", String(attempt || 0));
  return url.href;
}

async function priceReadbackOpenTask(run) {
  const tab = await chrome.tabs.create({
    url: priceReadbackPageUrl(run.task, run.runId, run.attempt),
    active: false,
  });
  run.tabId = tab?.id ?? null;
  run.openedAt = new Date().toISOString();
  await priceReadbackSaveRun(run);
}

async function priceReadbackSubmitPendingReport(run) {
  if (!run?.pendingReport) return false;
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    last = await priceReadbackPost({ action: "report", ...run.pendingReport }, 20000);
    if (last?.ok === true) {
      await priceReadbackCloseTab(run.tabId);
      await priceReadbackSaveRun(null);
      try {
        await chrome.alarms.create(SHOPLING_PRICE_READBACK_ALARM, { when: Date.now() + 1500 });
      } catch {
        // Recurring alarm remains the fallback.
      }
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  run.lastError = priceReadbackText(last?.message || "readback report failed");
  await priceReadbackSaveRun(run);
  return false;
}

async function priceReadbackRetryOrFail(run, reason) {
  await priceReadbackCloseTab(run.tabId);
  if (Number(run.attempt || 0) < SHOPLING_PRICE_READBACK_MAX_ATTEMPTS) {
    run.attempt = Number(run.attempt || 0) + 1;
    run.tabId = null;
    run.lastError = priceReadbackText(reason);
    await priceReadbackSaveRun(run);
    await priceReadbackOpenTask(run);
    return;
  }
  run.pendingReport = {
    runId: run.runId,
    taskId: run.task.taskId,
    observedRows: [],
    error: priceReadbackText(reason || "Shopling price page verification failed"),
    pageUrl: "",
    pageTitle: "",
  };
  await priceReadbackSaveRun(run);
  await priceReadbackSubmitPendingReport(run);
}

async function priceReadbackRecoverRun(run) {
  if (run.pendingReport) {
    await priceReadbackSubmitPendingReport(run);
    return true;
  }
  const openedAt = Date.parse(priceReadbackText(run.openedAt));
  if (!Number.isFinite(openedAt) || Date.now() - openedAt < SHOPLING_PRICE_READBACK_TIMEOUT_MS) {
    return true;
  }
  await priceReadbackRetryOrFail(
    run,
    `Shopling 가격 화면이 ${Math.round(SHOPLING_PRICE_READBACK_TIMEOUT_MS / 1000)}초 안에 읽기 완료되지 않았습니다.`,
  );
  return true;
}

async function priceReadbackProcessQueue() {
  const existing = await priceReadbackLoadRun();
  if (existing) {
    await priceReadbackRecoverRun(existing);
    return;
  }
  if (await priceReadbackOtherWorkerBusy()) return;

  const runId = priceReadbackRunId();
  const claimed = await priceReadbackPost({ action: "claim", runId }, 20000);
  if (!claimed?.ok || !claimed.task) return;
  const task = claimed.task;
  const goodsKey = priceReadbackText(task.goodsKey);
  const taskId = priceReadbackText(task.taskId);
  const targets = Array.isArray(task.mallTargets) ? task.mallTargets : [];
  if (!/^\d{5,9}$/.test(goodsKey) || !taskId || !targets.length) {
    await priceReadbackPost({
      action: "report",
      runId,
      taskId,
      observedRows: [],
      error: "Browser price readback claim payload validation failed.",
    });
    return;
  }

  const run = {
    runId,
    task,
    attempt: 0,
    tabId: null,
    openedAt: "",
    pendingReport: null,
    lastError: "",
  };
  await priceReadbackSaveRun(run);
  try {
    await priceReadbackOpenTask(run);
  } catch (error) {
    await priceReadbackRetryOrFail(
      run,
      error instanceof Error ? error.message : String(error || "Shopling price page open failed"),
    );
  }
}

async function priceReadbackEnsureAlarm() {
  try {
    const existing = await chrome.alarms.get(SHOPLING_PRICE_READBACK_ALARM);
    if (existing?.periodInMinutes === 0.5) return;
    await chrome.alarms.create(SHOPLING_PRICE_READBACK_ALARM, {
      delayInMinutes: 0.1,
      periodInMinutes: 0.5,
    });
  } catch {
    // Existing extension workers remain available even if alarm setup fails.
  }
}

void priceReadbackEnsureAlarm();
void priceReadbackProcessQueue();
chrome.runtime.onInstalled.addListener(() => {
  void priceReadbackEnsureAlarm();
  void priceReadbackProcessQueue();
});
chrome.runtime.onStartup.addListener(() => {
  void priceReadbackEnsureAlarm();
  void priceReadbackProcessQueue();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name !== SHOPLING_PRICE_READBACK_ALARM) return;
  void priceReadbackProcessQueue();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object" || message.type !== SHOPLING_PRICE_READBACK_PAGE_MESSAGE) {
    return false;
  }
  void (async () => {
    const run = await priceReadbackLoadRun();
    if (!run) {
      sendResponse({ ok: false, error: "price_readback_run_missing" });
      return;
    }
    const runId = priceReadbackText(message.runId);
    const taskId = priceReadbackText(message.taskId);
    const goodsKey = priceReadbackText(message.goodsKey);
    if (
      run.runId !== runId ||
      priceReadbackText(run.task?.taskId) !== taskId ||
      priceReadbackText(run.task?.goodsKey) !== goodsKey
    ) {
      sendResponse({ ok: false, error: "price_readback_run_mismatch" });
      return;
    }
    if (Number.isInteger(sender?.tab?.id) && Number.isInteger(run.tabId) && sender.tab.id !== run.tabId) {
      sendResponse({ ok: false, error: "price_readback_tab_mismatch" });
      return;
    }
    run.pendingReport = {
      runId,
      taskId,
      observedRows: Array.isArray(message.observedRows) ? message.observedRows : [],
      error: priceReadbackText(message.error),
      pageUrl: priceReadbackText(message.pageUrl),
      pageTitle: priceReadbackText(message.pageTitle),
    };
    await priceReadbackSaveRun(run);
    const recorded = await priceReadbackSubmitPendingReport(run);
    sendResponse({ ok: recorded, recorded });
  })().catch((error) => {
    sendResponse({
      ok: false,
      error: "price_readback_background_failed",
      message: error instanceof Error ? error.message : String(error || "price readback background failed"),
    });
  });
  return true;
});

(() => {
  const VERSION = "0.4.5";
  const STATE_KEY = "commerceOsShoplingStockStateV045";
  const TASK_TIMEOUT_MS = 15 * 60 * 1000;
  let processing = false;
  let timeoutHandle = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loadState() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    return stored[STATE_KEY] || {
      version: VERSION,
      queue: [],
      active: null,
      stage: "IDLE",
      message: "대기 중",
      updatedAt: Date.now(),
    };
  }

  async function saveState(state) {
    state.version = VERSION;
    state.updatedAt = Date.now();
    await chrome.storage.local.set({ [STATE_KEY]: state });
    return state;
  }

  function normalizeTask(task) {
    if (!task || typeof task !== "object") return null;
    const taskId = String(task.taskId || "").trim();
    const barcode = String(task.barcode || "").normalize("NFKC").toUpperCase().replace(/\s+/g, "");
    const modelNo = String(task.modelNo || "").trim() || null;
    const productKind = task.productKind === "SINGLE" ? "SINGLE" : task.productKind === "OPTION" ? "OPTION" : null;
    const targetState = task.targetState === "SOLD_OUT" ? "SOLD_OUT" : task.targetState === "ON_SALE" ? "ON_SALE" : null;
    if (!taskId || !/^[A-Z]{3}\d+-\d+$/.test(barcode) || !productKind || !targetState) return null;
    if (productKind === "SINGLE" && !modelNo) return null;
    return {
      taskId,
      barcode,
      modelNo,
      productKind,
      targetState,
      requestedAt: String(task.requestedAt || new Date().toISOString()),
      reason: String(task.reason || "MANUAL"),
      createdAt: Date.now(),
      attempt: 0,
      workerTabId: null,
    };
  }

  async function notifyOps(task, success, message, payload = null) {
    const tabs = await chrome.tabs.query({ url: "https://commerce-os-ops-center.vercel.app/*" });
    await Promise.all(
      tabs.map((tab) =>
        Number.isInteger(tab.id)
          ? chrome.tabs.sendMessage(tab.id, {
              type: "COMMERCE_OS_STOCK_SYNC_RESULT",
              task,
              success,
              message,
              payload,
              version: VERSION,
            }).catch(() => null)
          : null,
      ),
    );
  }

  async function setStage(stage, message, extra = {}) {
    const state = await loadState();
    if (!state.active) return state;
    state.stage = stage;
    state.message = message;
    Object.assign(state.active, extra);
    await saveState(state);
    return state;
  }

  async function findOrCreateWorkerTab() {
    const tabs = await chrome.tabs.query({ url: "https://a.shopling.co.kr/*" });
    const preferred = tabs.find((tab) => Number.isInteger(tab.id) && tab.active) || tabs[0];
    if (preferred && Number.isInteger(preferred.id)) return preferred;
    return chrome.tabs.create({ url: "https://a.shopling.co.kr/", active: true });
  }

  async function dispatchToTab(tabId) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const state = await loadState();
      if (!state.active) return false;
      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          type: "COMMERCE_OS_STOCK_TASK_ASSIGNMENT",
          task: state.active,
          stage: state.stage,
          version: VERSION,
        });
        if (response?.ok) return true;
      } catch {
        // Content script may still be loading.
      }
      await sleep(500);
    }
    return false;
  }

  async function finishActive(success, message, payload = null) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    timeoutHandle = null;
    const state = await loadState();
    const task = state.active;
    if (!task) return;
    state.active = null;
    state.stage = "IDLE";
    state.message = message;
    await saveState(state);
    await notifyOps(task, success, message, payload);
    processing = false;
    setTimeout(() => void processQueue(), 500);
  }

  async function processQueue() {
    if (processing) return;
    processing = true;
    const state = await loadState();
    if (state.active) {
      processing = false;
      return;
    }
    const task = state.queue.shift();
    if (!task) {
      state.stage = "IDLE";
      state.message = "대기 중";
      await saveState(state);
      processing = false;
      return;
    }
    task.attempt = Number(task.attempt || 0) + 1;
    task.startedAt = Date.now();
    state.active = task;
    state.stage = "NAVIGATE_A6";
    state.message = `${task.barcode} A6 옵션상태 변경 준비`;
    await saveState(state);

    try {
      const tab = await findOrCreateWorkerTab();
      if (!Number.isInteger(tab?.id)) {
        await finishActive(false, "Shopling 작업 탭을 만들지 못했습니다.");
        return;
      }
      await setStage("NAVIGATE_A6", `${task.barcode} A6 메뉴 이동`, {
        workerTabId: tab.id,
      });
      const dispatched = await dispatchToTab(tab.id);
      if (!dispatched) {
        await finishActive(false, "Shopling 탭에서 품절/판매중 자동화 스크립트를 시작하지 못했습니다.");
        return;
      }
      timeoutHandle = setTimeout(() => {
        void finishActive(false, `${task.barcode} Shopling 판매상태 동기화가 15분을 초과했습니다.`);
      }, TASK_TIMEOUT_MS);
    } catch (error) {
      await finishActive(false, String(error?.message || error || "Shopling 작업 시작 실패"));
    }
  }

  async function enqueueTasks(rawTasks) {
    const incoming = (Array.isArray(rawTasks) ? rawTasks : [])
      .map(normalizeTask)
      .filter(Boolean);
    const state = await loadState();
    const known = new Set([
      ...(state.active ? [state.active.taskId] : []),
      ...state.queue.map((task) => task.taskId),
    ]);
    for (const task of incoming) {
      if (known.has(task.taskId)) continue;
      state.queue.push(task);
      known.add(task.taskId);
    }
    await saveState(state);
    setTimeout(() => void processQueue(), 50);
    return state;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void (async () => {
      if (message?.type === "COMMERCE_OS_STOCK_TASKS") {
        const state = await enqueueTasks(message.tasks);
        sendResponse({ ok: true, queued: state.queue.length, active: state.active?.taskId || null });
        return;
      }
      if (message?.type === "COMMERCE_OS_STOCK_GET_ACTIVE") {
        const state = await loadState();
        sendResponse({ ok: true, active: state.active, stage: state.stage, version: VERSION });
        return;
      }
      if (message?.type === "COMMERCE_OS_STOCK_STAGE") {
        const state = await loadState();
        if (!state.active || state.active.taskId !== message.taskId) {
          sendResponse({ ok: false, error: "task_mismatch" });
          return;
        }
        state.stage = String(message.stage || state.stage);
        state.message = String(message.message || state.message || "");
        if (Number.isInteger(sender.tab?.id)) state.active.workerTabId = sender.tab.id;
        await saveState(state);
        sendResponse({ ok: true });
        if (Number.isInteger(sender.tab?.id) && message.redispatch === true) {
          setTimeout(() => void dispatchToTab(sender.tab.id), 250);
        }
        return;
      }
      if (message?.type === "COMMERCE_OS_STOCK_TASK_RESULT") {
        const state = await loadState();
        if (!state.active || state.active.taskId !== message.taskId) {
          sendResponse({ ok: false, error: "task_mismatch" });
          return;
        }
        sendResponse({ ok: true });
        await finishActive(
          message.success === true,
          String(message.message || (message.success ? "Shopling 동기화 완료" : "Shopling 동기화 실패")),
          message.payload || null,
        );
        return;
      }
      sendResponse({ ok: false, error: "unsupported_message" });
    })().catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== "complete") return;
    void (async () => {
      const state = await loadState();
      if (!state.active || state.active.workerTabId !== tabId) return;
      await dispatchToTab(tabId);
    })();
  });

  chrome.runtime.onStartup.addListener(() => setTimeout(() => void processQueue(), 1000));
  chrome.runtime.onInstalled.addListener(() => setTimeout(() => void processQueue(), 1000));
})();

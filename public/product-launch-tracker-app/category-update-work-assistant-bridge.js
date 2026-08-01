const CATEGORY_UPDATE_BUTTON_ID = "shopling-category-refresh-button";
const CATEGORY_UPDATE_CANCEL_ENDPOINT = "/api/shopling-categories/cancel";
const CATEGORY_UPDATE_SESSION_KEY = "commerce-os:shopling-category-update:v1";
const CATEGORY_WORK_TASK_KEY = "commerce-os-work-assistant:category-update:v1";
const CATEGORY_WORK_EVENT_SOURCE = "commerce-os-category-update";
const TERMINAL_TONES = new Set(["success", "warning", "failed", "cancelled"]);
let progressObserver = null;
let syncTimer = null;
let cancelBusy = false;

installCategoryUpdateBridge();

function installCategoryUpdateBridge() {
  document.addEventListener("click", handleCaptureClick, true);
  window.addEventListener("message", handleParentMessage);
  observeProgressUi();
  window.setInterval(() => {
    observeProgressUi();
    syncGlobalTaskFromPage();
  }, 1_500);
}

function handleCaptureClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const updateButton = target.closest(`#${CATEGORY_UPDATE_BUTTON_ID}`);
  if (updateButton && !updateButton.hasAttribute("disabled")) {
    window.setTimeout(() => syncGlobalTaskFromPage({ forceActive: true }), 0);
    window.setTimeout(() => syncGlobalTaskFromPage({ forceActive: true }), 300);
    return;
  }

  const cancelButton = target.closest(".category-update-progress-cancel");
  if (cancelButton) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    void cancelCategoryUpdate(cancelButton);
    return;
  }

  const backgroundButton = target.closest(".category-update-progress-minimize");
  if (!backgroundButton) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const backdrop = document.querySelector("#category-update-progress-backdrop");
  const card = document.querySelector("#category-update-progress-card");
  const session = readJson(CATEGORY_UPDATE_SESSION_KEY) ?? {};
  writeGlobalTask({
    ...taskFromPage(session, card),
    active: session.active !== false,
    backgrounded: true,
    updatedAt: new Date().toISOString(),
  });

  if (backdrop instanceof HTMLElement) {
    backdrop.hidden = true;
    backdrop.style.pointerEvents = "auto";
  }
  if (card instanceof HTMLElement) {
    card.classList.remove("category-update-progress-minimized");
    card.style.pointerEvents = "auto";
  }
  notifyParent();
}

function handleParentMessage(event) {
  if (event.origin !== window.location.origin) return;
  if (event.data?.source !== "commerce-os-work-assistant") return;
  if (event.data?.type !== "category-update-cancelled") return;
  finalizeLocalCancellation(
    String(event.data?.message || "사용자가 카테고리 업데이트를 취소했습니다."),
    String(event.data?.actionsUrl || ""),
  );
}

function observeProgressUi() {
  const card = document.querySelector("#category-update-progress-card");
  if (!(card instanceof HTMLElement)) return;
  ensureCancelButton(card);
  if (progressObserver?.target === card) return;
  progressObserver?.observer.disconnect();
  const observer = new MutationObserver(() => {
    ensureCancelButton(card);
    scheduleSync();
  });
  observer.observe(card, {
    attributes: true,
    attributeFilter: ["data-tone", "hidden"],
    childList: true,
    subtree: true,
    characterData: true,
  });
  progressObserver = { target: card, observer };
  scheduleSync();
}

function ensureCancelButton(card) {
  const actions = card.querySelector(".category-update-progress-actions");
  const minimizeButton = card.querySelector(".category-update-progress-minimize");
  if (!actions || actions.querySelector(".category-update-progress-cancel")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary category-update-progress-cancel";
  button.textContent = "업데이트 취소";
  button.style.borderColor = "#fca5a5";
  button.style.color = "#b91c1c";
  button.style.background = "#fff";
  button.title = "현재 GitHub Actions 작업을 중단하고 다시 업데이트할 수 있게 합니다.";
  if (minimizeButton) actions.insertBefore(button, minimizeButton);
  else actions.append(button);
}

async function cancelCategoryUpdate(button) {
  if (cancelBusy) return;
  if (!window.confirm("현재 샵플링 카테고리 업데이트를 취소할까요?\n취소 후 업데이트 버튼을 다시 눌러 새 작업을 시작할 수 있습니다.")) {
    return;
  }
  const session = readJson(CATEGORY_UPDATE_SESSION_KEY) ?? {};
  const task = readJson(CATEGORY_WORK_TASK_KEY) ?? {};
  cancelBusy = true;
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = "취소 중...";
  try {
    const response = await fetch(CATEGORY_UPDATE_CANCEL_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({
        requestId: session.requestId || task.requestId || "",
        startedAt: session.startedAt || task.startedAt || "",
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      throw new Error(body?.message || "카테고리 업데이트를 취소하지 못했습니다.");
    }
    finalizeLocalCancellation(
      body.message || "샵플링 카테고리 업데이트를 취소했습니다.",
      body.actionsUrl || session.actionsUrl || task.actionsUrl || "",
    );
  } catch (error) {
    button.disabled = false;
    button.textContent = previousText;
    window.alert(
      error instanceof Error
        ? error.message
        : "샵플링 카테고리 업데이트를 취소하지 못했습니다.",
    );
  } finally {
    cancelBusy = false;
  }
}

function finalizeLocalCancellation(message, actionsUrl) {
  const now = new Date().toISOString();
  const session = readJson(CATEGORY_UPDATE_SESSION_KEY) ?? {};
  const existing = readJson(CATEGORY_WORK_TASK_KEY) ?? {};
  try {
    localStorage.removeItem(CATEGORY_UPDATE_SESSION_KEY);
  } catch {
    // The page reload below clears the in-memory progress session.
  }
  writeGlobalTask({
    ...taskFromPage(session, document.querySelector("#category-update-progress-card"), existing),
    active: false,
    status: "cancelled",
    tone: "cancelled",
    backgrounded: true,
    actionsUrl: text(actionsUrl || existing.actionsUrl || session.actionsUrl),
    title: "샵플링 카테고리 업데이트 취소됨",
    message: text(message) || "사용자가 카테고리 업데이트를 취소했습니다.",
    detail: "다시 업데이트 가능",
    finishedAt: now,
    updatedAt: now,
  });
  const backdrop = document.querySelector("#category-update-progress-backdrop");
  if (backdrop instanceof HTMLElement) backdrop.hidden = true;
  notifyParent();
  window.setTimeout(() => window.location.reload(), 250);
}

function scheduleSync() {
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => syncGlobalTaskFromPage(), 20);
}

function syncGlobalTaskFromPage(options = {}) {
  const session = readJson(CATEGORY_UPDATE_SESSION_KEY);
  const card = document.querySelector("#category-update-progress-card");
  const existing = readJson(CATEGORY_WORK_TASK_KEY);
  if (!session && !existing && !options.forceActive) return;

  const next = taskFromPage(session ?? {}, card, existing ?? {});
  if (options.forceActive) next.active = true;
  if (!next.startedAt) next.startedAt = new Date().toISOString();
  next.updatedAt = new Date().toISOString();
  if (next.active === false && !next.finishedAt) {
    next.finishedAt = next.updatedAt;
  }
  writeGlobalTask(next);
}

function taskFromPage(session, card, existing = {}) {
  const title = text(
    card?.querySelector?.(".category-update-progress-title")?.textContent,
  );
  const message = text(
    card?.querySelector?.(".category-update-progress-message")?.textContent,
  );
  const detail = text(
    card?.querySelector?.(".category-update-progress-detail")?.textContent,
  );
  const tone = text(card?.dataset?.tone || session.lastStatus || existing.tone || "running");
  const active = session.active !== false && !TERMINAL_TONES.has(tone);
  const requestId = text(session.requestId || existing.requestId);
  const startedAt = text(session.startedAt || existing.startedAt);
  return {
    id: `shopling-category:${requestId || startedAt || "current"}`,
    kind: "shopling_category_update",
    label: "샵플링 카테고리 업데이트",
    active,
    status: active ? "running" : tone || "success",
    tone: active ? "running" : tone || "success",
    requestId,
    actionsUrl: text(session.actionsUrl || existing.actionsUrl),
    startedAt,
    finishedAt: text(session.finishedAt || existing.finishedAt),
    updatedAt: text(existing.updatedAt),
    backgrounded: Boolean(existing.backgrounded),
    title: title || text(existing.title) || "샵플링 카테고리 업데이트 진행 중",
    message:
      message ||
      text(existing.message) ||
      "샵플링 표준카테고리 목록을 읽고 있습니다.",
    detail: detail || text(existing.detail) || "완료 여부 자동 확인 중",
  };
}

function writeGlobalTask(task) {
  try {
    const previous = localStorage.getItem(CATEGORY_WORK_TASK_KEY);
    const next = JSON.stringify(task);
    if (previous === next) return;
    localStorage.setItem(CATEGORY_WORK_TASK_KEY, next);
  } catch {
    // The update itself must continue even when browser storage is unavailable.
  }
  notifyParent(task);
}

function notifyParent(task = readJson(CATEGORY_WORK_TASK_KEY)) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          source: CATEGORY_WORK_EVENT_SOURCE,
          type: "category-update-task-changed",
          task,
        },
        window.location.origin,
      );
    }
  } catch {
    // Parent notification is an optimization; localStorage remains the source of truth.
  }
}

function readJson(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

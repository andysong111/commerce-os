const CATEGORY_UPDATE_BUTTON_ID = "shopling-category-refresh-button";
const CATEGORY_CANCEL_ENDPOINT = "/api/shopling-categories/cancel";
const CATEGORY_SESSION_KEY = "commerce-os:shopling-category-update:v1";
const CATEGORY_TASK_KEY = "commerce-os-work-assistant:category-update:v1";
const CATEGORY_CANCEL_GUARD_KEY = "commerce-os:shopling-category-update-cancel-guard:v1";
const CATEGORY_EVENT_SOURCE = "commerce-os-category-update";
const originalStorageSetItem = Storage.prototype.setItem;
let cancelBusy = false;

installCancelGuard();

function installCancelGuard() {
  Storage.prototype.setItem = function guardedSetItem(key, value) {
    if (
      (key === CATEGORY_SESSION_KEY || key === CATEGORY_TASK_KEY) &&
      readJson(CATEGORY_CANCEL_GUARD_KEY)
    ) {
      return;
    }
    return originalStorageSetItem.call(this, key, value);
  };

  document.addEventListener("click", handleCaptureClick, true);
  window.addEventListener("message", handleCancelMessage, true);
  window.setInterval(enforceCancelGuard, 200);
  enforceCancelGuard();
}

function handleCaptureClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const updateButton = target.closest(`#${CATEGORY_UPDATE_BUTTON_ID}`);
  if (updateButton && !updateButton.hasAttribute("disabled")) {
    clearCancelGuardForNewUpdate();
    return;
  }

  const cancelButton = target.closest(".category-update-progress-cancel");
  if (!cancelButton) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  void cancelFromProgress(cancelButton);
}

function handleCancelMessage(event) {
  if (event.origin !== window.location.origin) return;
  if (event.data?.source !== "commerce-os-work-assistant") return;
  if (event.data?.type !== "category-update-cancelled") return;

  event.stopImmediatePropagation();
  installCancellationGuard({
    message: String(
      event.data?.message || "사용자가 샵플링 카테고리 업데이트를 취소했습니다.",
    ),
  });
}

async function cancelFromProgress(button) {
  if (cancelBusy) return;
  if (
    !window.confirm(
      "현재 샵플링 카테고리 업데이트를 취소할까요?\n취소 후 바로 새 업데이트를 시작할 수 있습니다.",
    )
  ) {
    return;
  }

  const session = readJson(CATEGORY_SESSION_KEY) ?? {};
  const task = readJson(CATEGORY_TASK_KEY) ?? {};
  cancelBusy = true;
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = "취소 중...";

  try {
    const response = await fetch(CATEGORY_CANCEL_ENDPOINT, {
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

    installCancellationGuard({
      requestId: session.requestId || task.requestId || "",
      startedAt: session.startedAt || task.startedAt || "",
      message: body.message || "샵플링 카테고리 업데이트를 취소했습니다.",
    });
    window.alert(body.message || "샵플링 카테고리 업데이트를 취소했습니다.");
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

function installCancellationGuard(input = {}) {
  const session = readJson(CATEGORY_SESSION_KEY) ?? {};
  const task = readJson(CATEGORY_TASK_KEY) ?? {};
  const guard = {
    requestId: text(input.requestId || session.requestId || task.requestId),
    startedAt: text(input.startedAt || session.startedAt || task.startedAt),
    cancelledAt: new Date().toISOString(),
    message: text(input.message) || "사용자가 카테고리 업데이트를 취소했습니다.",
  };
  originalStorageSetItem.call(
    window.localStorage,
    CATEGORY_CANCEL_GUARD_KEY,
    JSON.stringify(guard),
  );
  enforceCancelGuard();
}

function enforceCancelGuard() {
  const guard = readJson(CATEGORY_CANCEL_GUARD_KEY);
  if (!guard) return;

  const session = readJson(CATEGORY_SESSION_KEY);
  if (isNewerUpdate(session, guard)) {
    clearCancelGuardForNewUpdate();
    return;
  }

  window.localStorage.removeItem(CATEGORY_SESSION_KEY);
  window.localStorage.removeItem(CATEGORY_TASK_KEY);

  const backdrop = document.querySelector("#category-update-progress-backdrop");
  if (backdrop instanceof HTMLElement) {
    backdrop.hidden = true;
    backdrop.dataset.cancelSuppressed = "true";
    backdrop.style.display = "none";
    backdrop.style.pointerEvents = "none";
  }

  notifyParent(null);
}

function isNewerUpdate(session, guard) {
  if (!session || typeof session !== "object") return false;
  const cancelledAt = Date.parse(String(guard.cancelledAt || ""));
  const startedAt = Date.parse(String(session.startedAt || ""));
  const requestChanged =
    Boolean(session.requestId) &&
    Boolean(guard.requestId) &&
    String(session.requestId) !== String(guard.requestId);
  return (
    requestChanged ||
    (Number.isFinite(cancelledAt) &&
      Number.isFinite(startedAt) &&
      startedAt > cancelledAt)
  );
}

function clearCancelGuardForNewUpdate() {
  window.localStorage.removeItem(CATEGORY_CANCEL_GUARD_KEY);
  const backdrop = document.querySelector("#category-update-progress-backdrop");
  if (backdrop instanceof HTMLElement) {
    delete backdrop.dataset.cancelSuppressed;
    backdrop.style.removeProperty("display");
    backdrop.style.removeProperty("pointer-events");
  }
}

function notifyParent(task) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        {
          source: CATEGORY_EVENT_SOURCE,
          type: "category-update-task-changed",
          task,
        },
        window.location.origin,
      );
    }
  } catch {
    // localStorage cleanup remains the source of truth.
  }
}

function readJson(key) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const LOCAL_BASE = "http://127.0.0.1:8776";
const LOCAL_RESULT_ENDPOINT = "/api/shopling-categories/local-result";
const SESSION_KEY = "commerce-os:shopling-category-update:v1";
const TASK_KEY = "commerce-os-work-assistant:category-update:v1";
const DONE_KEY_PREFIX = "commerce-os:shopling-category-health-recovered:";
const EVENT_SOURCE = "commerce-os-category-update";
let recoveryBusy = false;
let readyResultFound = false;

window.setTimeout(() => void recoverPreservedResultFromHealth(), 1_200);
window.addEventListener("focus", () => void recoverPreservedResultFromHealth());

async function recoverPreservedResultFromHealth() {
  if (recoveryBusy) return;
  recoveryBusy = true;
  readyResultFound = false;
  try {
    const health = await localJson("/health");
    if (health.status !== "success" || health.resultReady !== true) return;

    const requestId = text(health.requestId);
    if (!requestId) return;
    readyResultFound = true;

    const doneKey = `${DONE_KEY_PREFIX}${requestId}`;
    if (window.localStorage.getItem(doneKey) === "1") return;

    const storedSession = readJson(SESSION_KEY) ?? {};
    if (
      storedSession.active === true &&
      text(storedSession.requestId) &&
      text(storedSession.requestId) !== requestId
    ) {
      return;
    }

    const now = new Date().toISOString();
    const session = {
      ...storedSession,
      mode: "local",
      active: true,
      requestId,
      startedAt: storedSession.startedAt || text(health.startedAt) || now,
      lastStatus: "saving_result",
      updatedAt: now,
    };
    const task = {
      ...(readJson(TASK_KEY) ?? {}),
      id: `shopling-category-local:${requestId}`,
      kind: "shopling_category_update",
      mode: "local",
      source: "shopling_local_runner",
      label: "샵플링 카테고리 업데이트",
      active: true,
      status: "saving_result",
      tone: "running",
      requestId,
      startedAt: session.startedAt,
      updatedAt: now,
      title: "보존된 샵플링 카테고리 저장 중",
      message: `재수집 없이 로컬에 보존된 ${Number(health.categoryCount || 0).toLocaleString("ko-KR")}개 결과를 Commerce OS에 저장하고 있습니다.`,
      detail: "재수집 없이 결과 저장 중",
      progress: 97,
    };
    writeJson(SESSION_KEY, session);
    writeJson(TASK_KEY, task);
    notifyParent(task);

    const localResult = await localJson(
      `/category-update/result?requestId=${encodeURIComponent(requestId)}`,
    );
    const response = await fetch(LOCAL_RESULT_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({ snapshot: localResult.snapshot }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      throw new Error(body?.message || `카테고리 저장 실패 HTTP ${response.status}`);
    }

    const finishedAt = new Date().toISOString();
    const categoryCount = Number(body.categoryCount || health.categoryCount || 0);
    const completeSession = {
      ...session,
      active: false,
      lastStatus: "success",
      finishedAt,
      updatedAt: finishedAt,
    };
    const completeTask = {
      ...task,
      active: false,
      status: "success",
      tone: "success",
      finishedAt,
      updatedAt: finishedAt,
      title: "샵플링 카테고리 업데이트 완료",
      message:
        body.message ||
        `샵플링 표준카테고리 ${categoryCount.toLocaleString("ko-KR")}개를 업데이트했습니다.`,
      detail: `카테고리 ${categoryCount.toLocaleString("ko-KR")}개 저장 완료`,
      progress: 100,
      categoryCount,
    };
    writeJson(SESSION_KEY, completeSession);
    writeJson(TASK_KEY, completeTask);
    window.localStorage.setItem(doneKey, "1");
    updateToolbarStatus(categoryCount);
    notifyParent(completeTask);
    showRecoveryNotice(categoryCount);
  } catch (error) {
    if (!readyResultFound) {
      console.debug("Shopling preserved-result health recovery skipped.", error);
      return;
    }
    const failedAt = new Date().toISOString();
    const storedSession = readJson(SESSION_KEY) ?? {};
    const requestId = text(storedSession.requestId);
    const failedSession = {
      ...storedSession,
      mode: "local",
      active: false,
      lastStatus: "failed",
      updatedAt: failedAt,
    };
    const failedTask = {
      ...(readJson(TASK_KEY) ?? {}),
      mode: "local",
      active: false,
      status: "failed",
      tone: "failed",
      requestId,
      updatedAt: failedAt,
      title: "보존된 카테고리 결과 저장 실패",
      message:
        error instanceof Error
          ? error.message
          : "보존된 샵플링 카테고리 결과를 저장하지 못했습니다.",
      detail: "수집 결과는 로컬 실행기에 계속 보존됨",
      progress: 97,
    };
    writeJson(SESSION_KEY, failedSession);
    writeJson(TASK_KEY, failedTask);
    notifyParent(failedTask);
    console.warn("Shopling preserved-result save failed.", error);
  } finally {
    recoveryBusy = false;
  }
}

async function localJson(path) {
  const response = await fetch(`${LOCAL_BASE}${path}`, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    targetAddressSpace: "loopback",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.message || `로컬 실행기 요청 실패 HTTP ${response.status}`);
  }
  return body;
}

function updateToolbarStatus(count) {
  const badge = document.querySelector("#shopling-category-status-badge");
  if (!(badge instanceof HTMLElement)) return;
  badge.textContent = `카테고리 ${count.toLocaleString("ko-KR")}개 · 방금 업데이트`;
  badge.style.color = "#047857";
  badge.title = "로컬 PC에 보존된 최신 샵플링 표준카테고리";
}

function showRecoveryNotice(count) {
  document.querySelector("#category-health-recovery-notice")?.remove();
  const notice = document.createElement("div");
  notice.id = "category-health-recovery-notice";
  notice.textContent = `보존된 샵플링 카테고리 ${count.toLocaleString("ko-KR")}개를 재수집 없이 저장했습니다.`;
  notice.style.cssText = [
    "position:fixed",
    "right:24px",
    "bottom:24px",
    "z-index:2147483600",
    "max-width:440px",
    "padding:14px 18px",
    "border-radius:12px",
    "background:#065f46",
    "color:white",
    "font-size:13px",
    "font-weight:800",
    "box-shadow:0 16px 40px rgba(15,23,42,.28)",
  ].join(";");
  document.body.append(notice);
  window.setTimeout(() => notice.remove(), 8_000);
}

function notifyParent(task) {
  try {
    window.parent?.postMessage(
      {
        source: EVENT_SOURCE,
        type: "category-update-task-changed",
        task,
      },
      window.location.origin,
    );
  } catch {
    // localStorage remains the source of truth.
  }
}

function readJson(key) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "null");
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const LOCAL_BASE = "http://127.0.0.1:8776";
const LOCAL_RESULT_ENDPOINT = "/api/shopling-categories/local-result";
const SESSION_KEY = "commerce-os:shopling-category-update:v1";
const TASK_KEY = "commerce-os-work-assistant:category-update:v1";
const EVENT_SOURCE = "commerce-os-category-update";
let recoveryBusy = false;

window.setTimeout(() => void recoverPreservedCategoryResult(), 900);
window.addEventListener("focus", () => void recoverPreservedCategoryResult());

async function recoverPreservedCategoryResult() {
  if (recoveryBusy) return;
  const storedSession = readJson(SESSION_KEY) ?? {};
  const storedTask = readJson(TASK_KEY) ?? {};
  const requestId = text(storedSession.requestId || storedTask.requestId);
  const mode = text(storedSession.mode || storedTask.mode);
  const active = storedSession.active === true || storedTask.active === true;
  const preservedFailure =
    text(storedTask.status) === "failed" ||
    text(storedSession.lastStatus) === "failed" ||
    text(storedTask.detail).includes("로컬 실행기에 보존") ||
    text(storedTask.message).includes("personal access token");
  if (!requestId || mode !== "local" || active || !preservedFailure) return;

  recoveryBusy = true;
  try {
    const health = await localJson("/health");
    if (
      health.status !== "success" ||
      health.resultReady !== true ||
      text(health.requestId) !== requestId
    ) {
      return;
    }

    const now = new Date().toISOString();
    const session = {
      ...storedSession,
      mode: "local",
      active: true,
      requestId,
      startedAt: storedSession.startedAt || storedTask.startedAt || now,
      lastStatus: "saving_result",
      updatedAt: now,
    };
    const task = {
      ...storedTask,
      id: storedTask.id || `shopling-category-local:${requestId}`,
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
      title: "샵플링 카테고리 결과 저장 재시도 중",
      message: "로컬 실행기에 보존된 수집 결과를 Supabase에 저장하고 있습니다.",
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
      throw new Error(body?.message || "보존된 카테고리 결과를 저장하지 못했습니다.");
    }

    const finishedAt = new Date().toISOString();
    const count = Number(body.categoryCount || 0);
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
        `샵플링 표준카테고리 ${count.toLocaleString("ko-KR")}개를 업데이트했습니다.`,
      detail: `카테고리 ${count.toLocaleString("ko-KR")}개 저장 완료`,
      progress: 100,
      categoryCount: count,
    };
    writeJson(SESSION_KEY, completeSession);
    writeJson(TASK_KEY, completeTask);
    updateToolbarStatus(count);
    notifyParent(completeTask);
    showRecoveryNotice(count);
  } catch (error) {
    const failedAt = new Date().toISOString();
    const session = {
      ...storedSession,
      mode: "local",
      active: false,
      requestId,
      lastStatus: "failed",
      updatedAt: failedAt,
    };
    const task = {
      ...storedTask,
      mode: "local",
      active: false,
      status: "failed",
      tone: "failed",
      requestId,
      updatedAt: failedAt,
      title: "카테고리 결과 저장 재시도 실패",
      message:
        error instanceof Error
          ? error.message
          : "보존된 카테고리 결과를 저장하지 못했습니다.",
      detail: "수집 결과는 로컬 실행기에 계속 보존됨",
      progress: 97,
    };
    writeJson(SESSION_KEY, session);
    writeJson(TASK_KEY, task);
    notifyParent(task);
  } finally {
    recoveryBusy = false;
  }
}

async function localJson(path) {
  let response;
  try {
    response = await fetch(`${LOCAL_BASE}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      targetAddressSpace: "local",
    });
  } catch {
    return Promise.reject(new Error("로컬 실행기에 연결할 수 없습니다."));
  }
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
  badge.title = "로컬 PC에서 수집한 최신 샵플링 표준카테고리";
}

function showRecoveryNotice(count) {
  const existing = document.querySelector("#category-result-recovery-notice");
  existing?.remove();
  const notice = document.createElement("div");
  notice.id = "category-result-recovery-notice";
  notice.textContent = `보존된 샵플링 카테고리 ${count.toLocaleString("ko-KR")}개를 저장했습니다.`;
  notice.style.cssText = [
    "position:fixed",
    "right:24px",
    "bottom:24px",
    "z-index:2147483600",
    "max-width:420px",
    "padding:14px 18px",
    "border-radius:12px",
    "background:#065f46",
    "color:white",
    "font-size:13px",
    "font-weight:800",
    "box-shadow:0 16px 40px rgba(15,23,42,.28)",
  ].join(";");
  document.body.append(notice);
  window.setTimeout(() => notice.remove(), 7_000);
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
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

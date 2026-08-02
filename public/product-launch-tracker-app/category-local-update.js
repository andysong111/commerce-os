const CATEGORY_BUTTON_ID = "shopling-category-refresh-button";
const LOCAL_BASE = "http://127.0.0.1:8776";
const LOCAL_RESULT_ENDPOINT = "/api/shopling-categories/local-result";
const SESSION_KEY = "commerce-os:shopling-category-update:v1";
const TASK_KEY = "commerce-os-work-assistant:category-update:v1";
const CANCEL_GUARD_KEY = "commerce-os:shopling-category-update-cancel-guard:v1";
const EVENT_SOURCE = "commerce-os-category-update";
const POLL_MS = 2_000;
let pollTimer = null;
let elapsedTimer = null;
let consecutivePollErrors = 0;
let busy = false;
let ui = null;

installLocalCategoryUpdate();

function installLocalCategoryUpdate() {
  document.addEventListener("click", captureUpdateClick, true);
  window.addEventListener("message", handleParentMessage);
  resumeLocalSession();
}

function captureUpdateClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest(`#${CATEGORY_BUTTON_ID}`);
  if (!button || button.hasAttribute("disabled")) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  void startLocalUpdate(button);
}

function handleParentMessage(event) {
  if (event.origin !== window.location.origin) return;
  if (event.data?.source !== "commerce-os-work-assistant") return;
  if (event.data?.type !== "category-local-update-cancel") return;
  void cancelLocalUpdate({ confirm: false });
}

async function startLocalUpdate(button) {
  if (busy) return;
  const existing = readJson(SESSION_KEY);
  if (existing?.active && existing?.mode === "local") {
    showOverlay();
    window.alert("이미 로컬 샵플링 카테고리 업데이트가 진행 중입니다.");
    return;
  }

  busy = true;
  const previousText = button.textContent;
  button.disabled = true;
  button.textContent = "로컬 실행기 확인 중...";
  clearLegacyState();

  try {
    await localJson("/health", { method: "GET" });
    const requestId = makeRequestId();
    const startedAt = new Date().toISOString();
    const session = {
      mode: "local",
      active: true,
      requestId,
      startedAt,
      localBase: LOCAL_BASE,
      lastStatus: "starting",
    };
    writeJson(SESSION_KEY, session);
    setTask({
      session,
      status: "starting",
      progress: 2,
      message: "승준님 PC의 샵플링 카테고리 실행기를 시작하고 있습니다.",
    });
    showOverlay();
    renderOverlay({
      tone: "running",
      title: "샵플링 카테고리 업데이트 시작 중",
      message: "같은 PC·같은 접속 환경에서 샵플링 카테고리를 읽습니다.",
      detail: "로컬 실행기 작업 등록 중",
      progress: 2,
    });
    startElapsedClock();

    const response = await localJson("/category-update/start", {
      method: "POST",
      body: { requestId },
    });
    applyLocalStatus(response);
    startPolling();
  } catch (error) {
    finishLocalUpdate({
      status: "failed",
      tone: "failed",
      title: "로컬 실행기 연결 필요",
      message:
        error instanceof Error
          ? `${error.message}\nshopling-product-upload-auto 폴더의 start_shopling_category_local.cmd를 실행하세요.`
          : "샵플링 카테고리 로컬 실행기에 연결하지 못했습니다.",
      detail: "로컬 실행기 미연결",
      progress: 0,
    });
  } finally {
    busy = false;
    button.disabled = false;
    button.textContent = previousText;
  }
}

function resumeLocalSession() {
  const session = readJson(SESSION_KEY);
  if (!session?.active || session?.mode !== "local" || !session?.requestId) return;
  showOverlay();
  renderOverlay({
    tone: "running",
    title: "샵플링 카테고리 업데이트 진행 중",
    message: "로컬 실행기의 현재 상태를 다시 확인하고 있습니다.",
    detail: "연결 복구 중",
    progress: Number(readJson(TASK_KEY)?.progress || 5),
  });
  startElapsedClock();
  startPolling();
}

function startPolling() {
  window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => void pollLocalStatus(), POLL_MS);
  window.setTimeout(() => void pollLocalStatus(), 300);
}

async function pollLocalStatus() {
  const session = readJson(SESSION_KEY);
  if (!session?.active || session?.mode !== "local") {
    window.clearInterval(pollTimer);
    return;
  }
  try {
    const status = await localJson(
      `/category-update/status?requestId=${encodeURIComponent(session.requestId)}`,
      { method: "GET" },
    );
    consecutivePollErrors = 0;
    applyLocalStatus(status);
  } catch (error) {
    consecutivePollErrors += 1;
    renderOverlay({
      tone: "running",
      title: "샵플링 카테고리 업데이트 연결 확인 중",
      message:
        "로컬 실행기 응답을 다시 확인하고 있습니다. 실행기 창을 닫지 마세요.",
      detail: `연결 재시도 ${consecutivePollErrors}회`,
      progress: Number(readJson(TASK_KEY)?.progress || 5),
    });
    if (consecutivePollErrors >= 8) {
      finishLocalUpdate({
        status: "failed",
        tone: "failed",
        title: "로컬 실행기 연결 끊김",
        message:
          error instanceof Error
            ? error.message
            : "샵플링 카테고리 로컬 실행기의 응답이 없습니다.",
        detail: "실행기 재시작 필요",
        progress: 0,
      });
    }
  }
}

function applyLocalStatus(source) {
  const status = String(source?.status || "running");
  const progress = clampProgress(source?.progress);
  const message = String(source?.message || "샵플링 카테고리를 읽고 있습니다.");
  const session = readJson(SESSION_KEY) ?? {};
  session.lastStatus = status;
  session.updatedAt = new Date().toISOString();
  writeJson(SESSION_KEY, session);

  if (status === "success") {
    window.clearInterval(pollTimer);
    void uploadLocalResult(session.requestId);
    return;
  }
  if (status === "failed" || status === "manual_login_required") {
    finishLocalUpdate({
      status,
      tone: status === "manual_login_required" ? "warning" : "failed",
      title:
        status === "manual_login_required"
          ? "샵플링 로그인 확인 필요"
          : "샵플링 카테고리 업데이트 실패",
      message,
      detail: status === "manual_login_required" ? "로그인 후 다시 실행" : "오류 확인 필요",
      progress,
    });
    return;
  }
  if (status === "cancelled") {
    clearLocalProgress();
    return;
  }

  const waiting = status === "waiting_for_login";
  const title = waiting
    ? "샵플링 로그인·보안문자 입력 대기 중"
    : "샵플링 카테고리 업데이트 진행 중";
  const detail = waiting
    ? "열린 샵플링 브라우저에서 직접 입력"
    : `${progress}% · 로컬 PC에서 수집 중`;
  setTask({ session, status, progress, message, waiting });
  renderOverlay({
    tone: waiting ? "warning" : "running",
    title,
    message,
    detail,
    progress,
  });
}

async function uploadLocalResult(requestId) {
  renderOverlay({
    tone: "running",
    title: "샵플링 카테고리 결과 저장 중",
    message: "로컬 PC에서 수집한 카테고리를 Commerce OS에 반영하고 있습니다.",
    detail: "결과 검증·저장 중",
    progress: 96,
  });
  try {
    const localResult = await localJson(
      `/category-update/result?requestId=${encodeURIComponent(requestId)}`,
      { method: "GET" },
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
      throw new Error(body?.message || "수집 결과를 Commerce OS에 저장하지 못했습니다.");
    }
    finishLocalUpdate({
      status: "success",
      tone: "success",
      title: "샵플링 카테고리 업데이트 완료",
      message:
        body.message ||
        `샵플링 표준카테고리 ${Number(body.categoryCount || 0).toLocaleString("ko-KR")}개를 업데이트했습니다.`,
      detail: `카테고리 ${Number(body.categoryCount || 0).toLocaleString("ko-KR")}개 저장 완료`,
      progress: 100,
      categoryCount: Number(body.categoryCount || 0),
      commitSha: String(body.commitSha || ""),
    });
    updateToolbarStatus(body);
  } catch (error) {
    finishLocalUpdate({
      status: "failed",
      tone: "failed",
      title: "카테고리 결과 저장 실패",
      message:
        error instanceof Error
          ? error.message
          : "로컬 카테고리 결과를 저장하지 못했습니다.",
      detail: "수집 결과는 로컬 실행기에 보존됨",
      progress: 96,
    });
  }
}

function finishLocalUpdate(input) {
  window.clearInterval(pollTimer);
  window.clearInterval(elapsedTimer);
  const session = readJson(SESSION_KEY) ?? {};
  session.active = false;
  session.lastStatus = input.status;
  session.finishedAt = new Date().toISOString();
  session.updatedAt = session.finishedAt;
  writeJson(SESSION_KEY, session);
  setTask({ session, ...input, active: false });
  renderOverlay(input);
  const overlay = ensureOverlay();
  overlay.cancelButton.hidden = true;
  overlay.backgroundButton.hidden = true;
  overlay.confirmButton.hidden = false;
  overlay.confirmButton.textContent = "확인";
}

async function cancelLocalUpdate(options = { confirm: true }) {
  const session = readJson(SESSION_KEY);
  if (!session?.requestId || session?.mode !== "local") {
    clearLocalProgress();
    return;
  }
  if (
    options.confirm !== false &&
    !window.confirm("현재 로컬 샵플링 카테고리 업데이트를 취소할까요?")
  ) {
    return;
  }
  try {
    await localJson("/category-update/cancel", {
      method: "POST",
      body: { requestId: session.requestId },
    });
  } catch {
    // Browser state must still be cleared when the local process already ended.
  }
  clearLocalProgress();
}

function clearLocalProgress() {
  window.clearInterval(pollTimer);
  window.clearInterval(elapsedTimer);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(TASK_KEY);
  localStorage.removeItem(CANCEL_GUARD_KEY);
  const overlay = document.querySelector("#category-local-update-backdrop");
  overlay?.remove();
  ui = null;
  notifyParent(null);
}

function setTask(input) {
  const session = input.session ?? readJson(SESSION_KEY) ?? {};
  const status = String(input.status || session.lastStatus || "running");
  const active = input.active ?? session.active !== false;
  const now = new Date().toISOString();
  const task = {
    id: `shopling-category-local:${session.requestId || session.startedAt || "current"}`,
    kind: "shopling_category_update",
    mode: "local",
    source: "shopling_local_runner",
    label: "샵플링 카테고리 업데이트",
    active,
    status,
    tone:
      input.tone ||
      (active ? "running" : status === "success" ? "success" : status === "manual_login_required" ? "warning" : "failed"),
    requestId: session.requestId || "",
    startedAt: session.startedAt || now,
    finishedAt: active ? "" : session.finishedAt || now,
    updatedAt: now,
    backgrounded: Boolean(session.backgrounded),
    title:
      input.title ||
      (input.waiting
        ? "샵플링 로그인·보안문자 입력 대기 중"
        : active
          ? "샵플링 카테고리 업데이트 진행 중"
          : "샵플링 카테고리 업데이트 완료"),
    message: String(input.message || "샵플링 표준카테고리를 로컬 PC에서 읽고 있습니다."),
    detail: String(input.detail || `${clampProgress(input.progress)}% 진행`),
    progress: clampProgress(input.progress),
    categoryCount: Number(input.categoryCount || 0),
    commitSha: String(input.commitSha || ""),
    localBase: LOCAL_BASE,
  };
  writeJson(TASK_KEY, task);
  notifyParent(task);
}

function showOverlay() {
  const overlay = ensureOverlay();
  overlay.backdrop.hidden = false;
  overlay.backdrop.style.display = "grid";
}

function ensureOverlay() {
  if (ui && document.body.contains(ui.backdrop)) return ui;
  const style = document.createElement("style");
  style.id = "category-local-update-style";
  style.textContent = `
    @keyframes categoryLocalSpin { to { transform: rotate(360deg); } }
    #category-local-update-backdrop { position: fixed; inset: 0; z-index: 2147483001; display: grid; place-items: center; padding: 20px; background: rgba(15,23,42,.28); }
    #category-local-update-card { width: min(500px, calc(100vw - 32px)); border: 1px solid #bfdbfe; border-radius: 16px; background: #fff; box-shadow: 0 24px 70px rgba(15,23,42,.3); padding: 22px; color: #0f172a; box-sizing: border-box; }
    #category-local-update-card[data-tone="success"] { border-color: #86efac; }
    #category-local-update-card[data-tone="warning"] { border-color: #fbbf24; }
    #category-local-update-card[data-tone="failed"] { border-color: #fca5a5; }
    .category-local-head { display: flex; gap: 12px; align-items: flex-start; }
    .category-local-spinner { width: 24px; height: 24px; border: 3px solid #dbeafe; border-top-color: #2563eb; border-radius: 999px; animation: categoryLocalSpin .8s linear infinite; flex: 0 0 auto; }
    [data-tone="success"] .category-local-spinner { animation: none; border: 0; background: #16a34a; }
    [data-tone="success"] .category-local-spinner::after { content: "✓"; color: white; height: 24px; display: grid; place-items: center; font-weight: 900; }
    [data-tone="warning"] .category-local-spinner { border-top-color: #d97706; }
    [data-tone="failed"] .category-local-spinner { animation: none; border: 0; background: #dc2626; }
    [data-tone="failed"] .category-local-spinner::after { content: "×"; color: white; height: 24px; display: grid; place-items: center; font-weight: 900; }
    .category-local-copy { min-width: 0; flex: 1; }
    .category-local-title { margin: 0; font-size: 17px; font-weight: 900; }
    .category-local-message { margin: 7px 0 0; white-space: pre-line; color: #475569; font-size: 13px; line-height: 1.55; }
    .category-local-track { height: 7px; margin-top: 18px; overflow: hidden; border-radius: 999px; background: #e2e8f0; }
    .category-local-bar { height: 100%; width: 0; border-radius: inherit; background: #2563eb; transition: width .3s ease; }
    [data-tone="success"] .category-local-bar { background: #16a34a; }
    [data-tone="warning"] .category-local-bar { background: #d97706; }
    [data-tone="failed"] .category-local-bar { background: #dc2626; }
    .category-local-meta { display: flex; justify-content: space-between; gap: 12px; margin-top: 10px; color: #64748b; font-size: 11px; }
    .category-local-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    .category-local-actions button { min-height: 34px; border-radius: 8px; padding: 7px 12px; font-size: 12px; font-weight: 800; cursor: pointer; }
    .category-local-secondary { border: 1px solid #cbd5e1; background: #fff; color: #334155; }
    .category-local-danger { border: 1px solid #fca5a5; background: #fff; color: #b91c1c; }
    .category-local-primary { border: 0; background: #2563eb; color: #fff; }
  `;
  if (!document.querySelector(`#${style.id}`)) document.head.append(style);

  const backdrop = document.createElement("div");
  backdrop.id = "category-local-update-backdrop";
  const card = document.createElement("section");
  card.id = "category-local-update-card";
  card.dataset.tone = "running";
  card.innerHTML = `
    <div class="category-local-head">
      <span class="category-local-spinner" aria-hidden="true"></span>
      <div class="category-local-copy">
        <h2 class="category-local-title">샵플링 카테고리 업데이트 진행 중</h2>
        <p class="category-local-message">로컬 실행기를 확인하고 있습니다.</p>
      </div>
    </div>
    <div class="category-local-track"><div class="category-local-bar"></div></div>
    <div class="category-local-meta">
      <span class="category-local-elapsed">경과 0초</span>
      <span class="category-local-detail">로컬 PC 실행</span>
    </div>
    <div class="category-local-actions">
      <button type="button" class="category-local-danger category-local-cancel">업데이트 취소</button>
      <button type="button" class="category-local-secondary category-local-background">백그라운드로 보기</button>
      <button type="button" class="category-local-primary category-local-confirm" hidden>확인</button>
    </div>
  `;
  backdrop.append(card);
  document.body.append(backdrop);
  const title = card.querySelector(".category-local-title");
  const message = card.querySelector(".category-local-message");
  const detail = card.querySelector(".category-local-detail");
  const elapsed = card.querySelector(".category-local-elapsed");
  const bar = card.querySelector(".category-local-bar");
  const cancelButton = card.querySelector(".category-local-cancel");
  const backgroundButton = card.querySelector(".category-local-background");
  const confirmButton = card.querySelector(".category-local-confirm");
  cancelButton.addEventListener("click", () => void cancelLocalUpdate({ confirm: true }));
  backgroundButton.addEventListener("click", () => {
    const session = readJson(SESSION_KEY) ?? {};
    session.backgrounded = true;
    writeJson(SESSION_KEY, session);
    backdrop.hidden = true;
    backdrop.style.display = "none";
    const task = readJson(TASK_KEY);
    if (task) setTask({ ...task, session, active: task.active });
  });
  confirmButton.addEventListener("click", () => {
    backdrop.hidden = true;
    backdrop.style.display = "none";
  });
  ui = {
    backdrop,
    card,
    title,
    message,
    detail,
    elapsed,
    bar,
    cancelButton,
    backgroundButton,
    confirmButton,
  };
  return ui;
}

function renderOverlay(input) {
  const overlay = ensureOverlay();
  overlay.card.dataset.tone = input.tone || "running";
  overlay.title.textContent = String(input.title || "샵플링 카테고리 업데이트 진행 중");
  overlay.message.textContent = String(input.message || "");
  overlay.detail.textContent = String(input.detail || "");
  overlay.bar.style.width = `${clampProgress(input.progress)}%`;
  overlay.backdrop.hidden = false;
  overlay.backdrop.style.display = "grid";
}

function startElapsedClock() {
  window.clearInterval(elapsedTimer);
  updateElapsed();
  elapsedTimer = window.setInterval(updateElapsed, 1_000);
}

function updateElapsed() {
  if (!ui) return;
  const session = readJson(SESSION_KEY);
  const started = Date.parse(session?.startedAt || "");
  if (!Number.isFinite(started)) return;
  const total = Math.max(0, Math.floor((Date.now() - started) / 1_000));
  const minutes = Math.floor(total / 60);
  ui.elapsed.textContent = minutes ? `경과 ${minutes}분 ${total % 60}초` : `경과 ${total}초`;
}

async function localJson(path, options = {}) {
  const init = {
    method: options.method || "GET",
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
    targetAddressSpace: "loopback",
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  };
  let response;
  try {
    response = await fetch(`${LOCAL_BASE}${path}`, init);
  } catch (error) {
    throw new Error(
      `로컬 실행기(${LOCAL_BASE})에 연결할 수 없습니다. ${error instanceof Error ? error.message : ""}`.trim(),
    );
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    throw new Error(body?.message || `로컬 실행기 요청 실패 HTTP ${response.status}`);
  }
  return body;
}

function updateToolbarStatus(body) {
  const badge = document.querySelector("#shopling-category-status-badge");
  if (!(badge instanceof HTMLElement)) return;
  const count = Number(body?.categoryCount || 0);
  badge.textContent = `카테고리 ${count.toLocaleString("ko-KR")}개 · 방금 업데이트`;
  badge.style.color = "#047857";
  badge.title = "로컬 PC에서 수집한 최신 샵플링 표준카테고리";
}

function clearLegacyState() {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(TASK_KEY);
  localStorage.removeItem(CANCEL_GUARD_KEY);
  document.querySelector("#category-update-progress-backdrop")?.remove();
  notifyParent(null);
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
    // localStorage is the fallback source of truth.
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function readJson(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function makeRequestId() {
  const random = crypto.getRandomValues(new Uint32Array(1))[0].toString(16);
  return `shopling-local-${new Date().toISOString().replace(/[-:.]/g, "")}-${random}`;
}

function clampProgress(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

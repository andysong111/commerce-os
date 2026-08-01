const CATEGORY_UPDATE_REFRESH_ENDPOINT = "/api/shopling-categories/refresh";
const CATEGORY_UPDATE_STATUS_ENDPOINT = "/api/shopling-categories/status";
const CATEGORY_UPDATE_BUTTON_ID = "shopling-category-refresh-button";
const CATEGORY_UPDATE_SESSION_KEY = "commerce-os:shopling-category-update:v1";
const CATEGORY_UPDATE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const nativeFetch = window.fetch.bind(window);
const nativeAlert = window.alert.bind(window);
let updateSession = readUpdateSession();
let statusTimer = null;
let elapsedTimer = null;
let progressUi = null;
let minimized = false;

installAlertCopyNormalization();
installFetchObserver();
installUpdateClickCapture();
resumeActiveUpdate();

function normalizeUpdateCopy(value) {
  return String(value ?? "")
    .replaceAll("최신화", "업데이트")
    .replaceAll("최신 상태", "업데이트 상태");
}

function installAlertCopyNormalization() {
  if (window.__commerceOsCategoryAlertPatched) return;
  window.__commerceOsCategoryAlertPatched = true;
  window.alert = (message) => {
    const normalized = normalizeUpdateCopy(message);
    if (
      updateSession?.active &&
      /샵플링 카테고리 업데이트를 시작했습니다/.test(normalized)
    ) {
      setProgressState({
        tone: "running",
        title: "샵플링 카테고리 업데이트 진행 중",
        message:
          "업데이트 요청이 접수됐습니다. GitHub Actions에서 로그인 세션을 확인하고 카테고리 목록을 읽고 있습니다.",
      });
      return;
    }
    nativeAlert(normalized);
  };
}

function installFetchObserver() {
  if (window.__commerceOsCategoryFetchPatched) return;
  window.__commerceOsCategoryFetchPatched = true;
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const requestUrl = resolveRequestUrl(args[0]);
    if (requestUrl.includes(CATEGORY_UPDATE_REFRESH_ENDPOINT)) {
      void observeRefreshResponse(response.clone());
    }
    return response;
  };
}

function installUpdateClickCapture() {
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest(`#${CATEGORY_UPDATE_BUTTON_ID}`);
      if (!button || button.hasAttribute("disabled")) return;
      beginUpdateProgress();
    },
    true,
  );
}

function beginUpdateProgress() {
  const startedAt = new Date().toISOString();
  updateSession = {
    active: true,
    requestId: "",
    actionsUrl: "",
    startedAt,
    lastStatus: "dispatching",
  };
  persistUpdateSession();
  minimized = false;
  ensureProgressUi();
  setProgressState({
    tone: "running",
    title: "샵플링 카테고리 업데이트 요청 중",
    message:
      "업데이트 작업을 요청하고 있습니다. 요청이 접수되면 완료될 때까지 자동으로 상태를 확인합니다.",
  });
  startElapsedClock();
  startStatusPolling();
}

async function observeRefreshResponse(response) {
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!response.ok || body?.ok !== true) {
    finishUpdate({
      tone: "failed",
      title: "샵플링 카테고리 업데이트 요청 실패",
      message: normalizeUpdateCopy(
        body?.message || "업데이트 작업을 시작하지 못했습니다.",
      ),
    });
    return;
  }
  if (!updateSession?.active) beginUpdateProgress();
  updateSession.requestId = String(body.requestId || "");
  updateSession.actionsUrl = String(body.actionsUrl || "");
  updateSession.lastStatus = "requested";
  persistUpdateSession();
  setProgressState({
    tone: "running",
    title: "샵플링 카테고리 업데이트 진행 중",
    message:
      "요청이 접수됐습니다. 로그인 세션 확인과 카테고리 전수 수집이 진행됩니다. 이 창을 닫거나 페이지를 이동해도 작업은 계속됩니다.",
  });
  window.setTimeout(() => void pollUpdateStatus(), 1_500);
}

function startStatusPolling() {
  window.clearInterval(statusTimer);
  statusTimer = window.setInterval(() => void pollUpdateStatus(), 7_000);
  window.setTimeout(() => void pollUpdateStatus(), 700);
}

async function pollUpdateStatus() {
  if (!updateSession?.active) return;
  try {
    const response = await nativeFetch(CATEGORY_UPDATE_STATUS_ENDPOINT, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      setProgressDetail(
        normalizeUpdateCopy(body?.message || "업데이트 상태를 다시 확인하고 있습니다."),
      );
      return;
    }
    const status = body?.status ?? {};
    const statusRequestId = String(status.requestId || "");
    const sameRequest =
      Boolean(updateSession.requestId) &&
      statusRequestId === updateSession.requestId;
    const snapshotDate = body?.snapshot?.collectedAt
      ? Date.parse(body.snapshot.collectedAt)
      : 0;
    const startedDate = Date.parse(updateSession.startedAt || "") || 0;
    const newSnapshot = snapshotDate >= startedDate - 2_000;
    const runStatus = String(status.status || "");

    if ((sameRequest || newSnapshot) && runStatus === "success") {
      const count = Number(
        body?.snapshot?.categoryCount || status.categoryCount || 0,
      );
      finishUpdate({
        tone: "success",
        title: "샵플링 카테고리 업데이트 완료",
        message: count
          ? `샵플링 표준카테고리 ${count.toLocaleString("ko-KR")}개를 업데이트했습니다.`
          : normalizeUpdateCopy(status.message || "카테고리 업데이트가 완료됐습니다."),
      });
      return;
    }
    if (sameRequest && runStatus === "manual_login_required") {
      finishUpdate({
        tone: "warning",
        title: "샵플링 수동 로그인 필요",
        message: normalizeUpdateCopy(
          status.message ||
            "로그인 세션이 만료됐거나 보안문자 입력이 필요합니다. 로그인 세션을 갱신한 뒤 다시 업데이트하세요.",
        ),
      });
      return;
    }
    if (sameRequest && runStatus === "failed") {
      finishUpdate({
        tone: "failed",
        title: "샵플링 카테고리 업데이트 실패",
        message: normalizeUpdateCopy(
          status.message || "카테고리 업데이트 중 오류가 발생했습니다.",
        ),
      });
      return;
    }

    updateSession.lastStatus = runStatus || "running";
    persistUpdateSession();
    setProgressState({
      tone: "running",
      title: "샵플링 카테고리 업데이트 진행 중",
      message:
        "GitHub Actions에서 로그인 세션을 확인하고 대·중·소·세 카테고리를 읽고 있습니다. 완료 여부를 자동 확인 중입니다.",
    });
  } catch (error) {
    setProgressDetail(
      error instanceof Error
        ? `상태 확인 일시 실패: ${normalizeUpdateCopy(error.message)}`
        : "업데이트 상태를 다시 확인하고 있습니다.",
    );
  }
}

function finishUpdate({ tone, title, message }) {
  if (!updateSession) updateSession = {};
  updateSession.active = false;
  updateSession.lastStatus = tone;
  updateSession.finishedAt = new Date().toISOString();
  persistUpdateSession();
  window.clearInterval(statusTimer);
  window.clearInterval(elapsedTimer);
  minimized = false;
  setProgressState({ tone, title, message });
  if (progressUi) {
    progressUi.card.classList.remove("category-update-progress-minimized");
    progressUi.backdrop.style.pointerEvents = "auto";
    progressUi.actionButton.textContent = "확인";
    progressUi.actionButton.hidden = false;
    progressUi.minimizeButton.hidden = true;
    progressUi.actionsLink.hidden = !updateSession.actionsUrl;
  }
}

function ensureProgressUi() {
  if (progressUi) {
    progressUi.backdrop.hidden = false;
    return progressUi;
  }
  const style = document.createElement("style");
  style.textContent = `
    @keyframes categoryUpdateSpin { to { transform: rotate(360deg); } }
    @keyframes categoryUpdateBar { 0% { transform: translateX(-100%); } 100% { transform: translateX(320%); } }
    #category-update-progress-backdrop { position: fixed; inset: 0; z-index: 2147483000; background: rgba(15,23,42,.28); display: grid; place-items: center; padding: 20px; }
    #category-update-progress-card { width: min(480px, calc(100vw - 32px)); box-sizing: border-box; border: 1px solid #bfdbfe; border-radius: 16px; background: #fff; box-shadow: 0 24px 70px rgba(15,23,42,.28); padding: 22px; color: #0f172a; }
    #category-update-progress-card.category-update-progress-minimized { position: fixed; right: 18px; bottom: 18px; width: min(390px, calc(100vw - 36px)); padding: 14px 16px; }
    #category-update-progress-card[data-tone="success"] { border-color: #86efac; }
    #category-update-progress-card[data-tone="warning"] { border-color: #fbbf24; }
    #category-update-progress-card[data-tone="failed"] { border-color: #fca5a5; }
    .category-update-progress-head { display: flex; align-items: flex-start; gap: 12px; }
    .category-update-progress-spinner { width: 24px; height: 24px; border: 3px solid #dbeafe; border-top-color: #2563eb; border-radius: 999px; animation: categoryUpdateSpin .8s linear infinite; flex: 0 0 auto; }
    [data-tone="success"] .category-update-progress-spinner { animation: none; border: 0; background: #16a34a; }
    [data-tone="success"] .category-update-progress-spinner::after { content: "✓"; color: #fff; display: grid; place-items: center; height: 24px; font-weight: 900; }
    [data-tone="warning"] .category-update-progress-spinner { animation: none; border: 0; background: #d97706; }
    [data-tone="warning"] .category-update-progress-spinner::after { content: "!"; color: #fff; display: grid; place-items: center; height: 24px; font-weight: 900; }
    [data-tone="failed"] .category-update-progress-spinner { animation: none; border: 0; background: #dc2626; }
    [data-tone="failed"] .category-update-progress-spinner::after { content: "×"; color: #fff; display: grid; place-items: center; height: 24px; font-weight: 900; }
    .category-update-progress-copy { min-width: 0; flex: 1; }
    .category-update-progress-title { margin: 0; font-size: 17px; font-weight: 900; line-height: 1.35; }
    .category-update-progress-message { margin: 7px 0 0; color: #475569; font-size: 13px; line-height: 1.55; }
    .category-update-progress-bar { position: relative; height: 6px; margin-top: 18px; overflow: hidden; border-radius: 999px; background: #dbeafe; }
    .category-update-progress-bar::after { content: ""; position: absolute; inset: 0 auto 0 0; width: 34%; border-radius: inherit; background: #2563eb; animation: categoryUpdateBar 1.25s ease-in-out infinite; }
    [data-tone="success"] .category-update-progress-bar, [data-tone="warning"] .category-update-progress-bar, [data-tone="failed"] .category-update-progress-bar { display: none; }
    .category-update-progress-meta { display: flex; justify-content: space-between; gap: 12px; margin-top: 10px; color: #64748b; font-size: 11px; }
    .category-update-progress-actions { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-top: 18px; }
    .category-update-progress-actions button, .category-update-progress-actions a { min-height: 34px; box-sizing: border-box; padding: 7px 12px; border-radius: 8px; font-size: 12px; font-weight: 800; text-decoration: none; cursor: pointer; }
    .category-update-progress-actions button { border: 0; background: #2563eb; color: #fff; }
    .category-update-progress-actions .secondary { border: 1px solid #cbd5e1; background: #fff; color: #334155; }
    .category-update-progress-minimized .category-update-progress-message { max-height: 42px; overflow: hidden; }
    .category-update-progress-minimized .category-update-progress-bar { margin-top: 10px; }
  `;
  document.head.append(style);

  const backdrop = document.createElement("div");
  backdrop.id = "category-update-progress-backdrop";
  backdrop.setAttribute("role", "dialog");
  backdrop.setAttribute("aria-modal", "true");
  backdrop.setAttribute("aria-live", "polite");

  const card = document.createElement("section");
  card.id = "category-update-progress-card";
  card.dataset.tone = "running";
  card.innerHTML = `
    <div class="category-update-progress-head">
      <span class="category-update-progress-spinner" aria-hidden="true"></span>
      <div class="category-update-progress-copy">
        <h2 class="category-update-progress-title">샵플링 카테고리 업데이트 진행 중</h2>
        <p class="category-update-progress-message">업데이트 상태를 확인하고 있습니다.</p>
      </div>
    </div>
    <div class="category-update-progress-bar" aria-hidden="true"></div>
    <div class="category-update-progress-meta">
      <span class="category-update-progress-elapsed">경과 0초</span>
      <span class="category-update-progress-detail">자동 상태 확인 중</span>
    </div>
    <div class="category-update-progress-actions">
      <a class="secondary category-update-progress-actions-link" target="_blank" rel="noopener noreferrer" hidden>GitHub Actions 열기</a>
      <button type="button" class="secondary category-update-progress-minimize">백그라운드로 보기</button>
      <button type="button" class="category-update-progress-confirm" hidden>확인</button>
    </div>
  `;
  backdrop.append(card);
  document.body.append(backdrop);

  const title = card.querySelector(".category-update-progress-title");
  const message = card.querySelector(".category-update-progress-message");
  const elapsed = card.querySelector(".category-update-progress-elapsed");
  const detail = card.querySelector(".category-update-progress-detail");
  const minimizeButton = card.querySelector(".category-update-progress-minimize");
  const actionButton = card.querySelector(".category-update-progress-confirm");
  const actionsLink = card.querySelector(".category-update-progress-actions-link");

  minimizeButton.addEventListener("click", () => {
    minimized = true;
    card.classList.add("category-update-progress-minimized");
    backdrop.style.pointerEvents = "none";
    card.style.pointerEvents = "auto";
    minimizeButton.textContent = "진행창 펼치기";
  });
  card.addEventListener("click", (event) => {
    if (
      minimized &&
      event.target instanceof Element &&
      !event.target.closest("a")
    ) {
      minimized = false;
      card.classList.remove("category-update-progress-minimized");
      backdrop.style.pointerEvents = "auto";
      minimizeButton.textContent = "백그라운드로 보기";
    }
  });
  actionButton.addEventListener("click", () => {
    backdrop.hidden = true;
  });

  progressUi = {
    backdrop,
    card,
    title,
    message,
    elapsed,
    detail,
    minimizeButton,
    actionButton,
    actionsLink,
  };
  return progressUi;
}

function setProgressState({ tone, title, message }) {
  const ui = ensureProgressUi();
  ui.card.dataset.tone = tone;
  ui.title.textContent = normalizeUpdateCopy(title);
  ui.message.textContent = normalizeUpdateCopy(message);
  ui.actionsLink.href = updateSession?.actionsUrl || "#";
  ui.actionsLink.hidden = !updateSession?.actionsUrl;
}

function setProgressDetail(message) {
  const ui = ensureProgressUi();
  ui.detail.textContent = normalizeUpdateCopy(message);
}

function startElapsedClock() {
  window.clearInterval(elapsedTimer);
  updateElapsedCopy();
  elapsedTimer = window.setInterval(updateElapsedCopy, 1_000);
}

function updateElapsedCopy() {
  if (!progressUi || !updateSession?.startedAt) return;
  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(updateSession.startedAt)) / 1_000),
  );
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  progressUi.elapsed.textContent = minutes
    ? `경과 ${minutes}분 ${seconds}초`
    : `경과 ${seconds}초`;
}

function resumeActiveUpdate() {
  if (!updateSession?.active) return;
  const startedAt = Date.parse(updateSession.startedAt || "");
  if (!startedAt || Date.now() - startedAt > CATEGORY_UPDATE_MAX_AGE_MS) {
    clearUpdateSession();
    return;
  }
  ensureProgressUi();
  setProgressState({
    tone: "running",
    title: "샵플링 카테고리 업데이트 진행 중",
    message:
      "이전에 시작한 업데이트 작업의 완료 여부를 다시 확인하고 있습니다.",
  });
  startElapsedClock();
  startStatusPolling();
}

function resolveRequestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input ?? "");
}

function readUpdateSession() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(CATEGORY_UPDATE_SESSION_KEY) || "null",
    );
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function persistUpdateSession() {
  try {
    localStorage.setItem(
      CATEGORY_UPDATE_SESSION_KEY,
      JSON.stringify(updateSession),
    );
  } catch {
    // Local storage failure must not stop the update itself.
  }
}

function clearUpdateSession() {
  updateSession = null;
  try {
    localStorage.removeItem(CATEGORY_UPDATE_SESSION_KEY);
  } catch {
    // Ignore local storage cleanup failures.
  }
}

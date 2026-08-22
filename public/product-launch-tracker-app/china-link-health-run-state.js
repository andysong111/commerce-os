const HEALTH_API = "/api/product-launch-tracker/china-link-health";
const RUN_KEY = "commerceOs.chinaLinkAudit.run.v1";
const REQUIRED_COLLECTOR_VERSION = "0.1.3";
const ACTIVE_HEARTBEAT_MS = 90_000;
const STATUS_ID = "china-link-audit-run-status";

let messageObserver = null;
let installTimer = null;
let installAttempts = 0;
let summary = null;

function text(value) {
  return String(value ?? "").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function versionAtLeast(current, required) {
  const parse = (value) =>
    String(value || "")
      .split(".")
      .slice(0, 3)
      .map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(current);
  const right = parse(required);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) return true;
    if ((left[index] || 0) < (right[index] || 0)) return false;
  }
  return true;
}

function collectorVersion() {
  const local =
    document.documentElement.dataset.commerceOsKeywordLabCollectorVersion || "";
  if (local) return local;
  try {
    return (
      window.parent?.document?.documentElement?.dataset
        ?.commerceOsKeywordLabCollectorVersion || ""
    );
  } catch {
    return "";
  }
}

function readRun() {
  try {
    const raw = window.localStorage.getItem(RUN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeRun(patch) {
  const previous = readRun() || {};
  const next = {
    ...previous,
    ...patch,
    heartbeatAt: new Date().toISOString(),
  };
  window.localStorage.setItem(RUN_KEY, JSON.stringify(next));
  renderStatus();
  return next;
}

function activeRun(run = readRun()) {
  if (!run || run.status !== "running") return null;
  const heartbeat = Date.parse(run.heartbeatAt || run.startedAt || "");
  if (!Number.isFinite(heartbeat)) return null;
  return Date.now() - heartbeat <= ACTIVE_HEARTBEAT_MS ? run : null;
}

function ensureStatusElement() {
  const panel = document.querySelector("#china-link-health-panel");
  if (!panel) return null;
  let element = panel.querySelector(`#${STATUS_ID}`);
  if (element) return element;
  element = document.createElement("div");
  element.id = STATUS_ID;
  element.style.marginTop = "8px";
  element.style.padding = "9px 11px";
  element.style.borderRadius = "9px";
  element.style.background = "#fff7ed";
  element.style.border = "1px solid #fed7aa";
  element.style.color = "#7c2d12";
  element.style.fontSize = "11px";
  element.style.fontWeight = "850";
  element.style.lineHeight = "1.5";
  const message = panel.querySelector("#china-link-health-message");
  if (message?.parentElement) {
    message.parentElement.insertBefore(element, message.nextSibling);
  } else {
    panel.append(element);
  }
  return element;
}

function renderCollectorRequirement() {
  const panel = document.querySelector("#china-link-health-panel");
  if (!panel) return;
  const badge = panel.querySelector("#china-link-health-collector");
  const version = collectorVersion();
  const ready = versionAtLeast(version, REQUIRED_COLLECTOR_VERSION);
  if (badge) {
    badge.textContent = ready
      ? `Collector ${version}`
      : `Collector ${version || "미설치"} · ${REQUIRED_COLLECTOR_VERSION} 필요`;
    badge.style.color = ready ? "#047857" : "#be123c";
  }
}

function renderStatus() {
  const element = ensureStatusElement();
  if (!element) return;
  const run = readRun();
  const active = activeRun(run);
  if (active) {
    const completed = number(active.completed);
    const total = number(active.total);
    const scope = active.scope === "all" ? "전체재검사" : "저속 검사";
    element.textContent = `${scope} 진행 중 · ${completed.toLocaleString()}/${
      total ? total.toLocaleString() : "?"
    } · 이 화면과 작은 검사창을 유지하세요.`;
    element.style.background = "#eff6ff";
    element.style.borderColor = "#bfdbfe";
    element.style.color = "#1e3a8a";
    return;
  }

  if (run?.status === "completed") {
    element.textContent = `최근 ${run.scope === "all" ? "전체재검사" : "저속 검사"} 완료 · ${number(
      run.completed,
    ).toLocaleString()}/${number(run.total).toLocaleString()} · 확정 오류 ${number(
      run.permanentErrors,
    ).toLocaleString()} · 일시 오류 ${number(run.temporaryErrors).toLocaleString()}`;
    element.style.background = "#ecfdf5";
    element.style.borderColor = "#a7f3d0";
    element.style.color = "#065f46";
    return;
  }

  if (run?.status === "cancelled" || run?.status === "interrupted") {
    element.textContent = `최근 검사가 ${run.status === "cancelled" ? "중단" : "화면 이동으로 중단"}되었습니다 · ${number(
      run.completed,
    ).toLocaleString()}/${number(run.total).toLocaleString()} · 현재 미검사 ${number(
      summary?.unchecked,
    ).toLocaleString()}건`;
    element.style.background = "#fff7ed";
    element.style.borderColor = "#fed7aa";
    element.style.color = "#9a3412";
    return;
  }

  if (summary) {
    const inspected = Math.max(
      0,
      number(summary.withPrimaryLink) - number(summary.unchecked),
    );
    element.textContent = `저장된 검사 상태 · ${inspected.toLocaleString()}/${number(
      summary.withPrimaryLink,
    ).toLocaleString()} 검사됨 · 미검사 ${number(summary.unchecked).toLocaleString()} · 일시 오류 ${number(
      summary.temporaryErrors,
    ).toLocaleString()}건은 재검사 대상`;
  } else {
    element.textContent = "최근 검사 상태를 확인하는 중입니다.";
  }
}

async function loadSummary() {
  try {
    const response = await fetch(`${HEALTH_API}?mode=summary`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body?.ok === true) summary = body.summary || null;
  } catch {
    summary = null;
  }
  renderStatus();
}

function parseProgress(message) {
  const matched = text(message).match(/^(\d+)\/(\d+)\s*·/);
  return matched
    ? { completed: Math.max(0, Number(matched[1]) - 1), total: Number(matched[2]) }
    : null;
}

function parseCompletion(message) {
  const matched = text(message).match(
    /저속 검사 완료\s*·\s*(\d+)건\s*·\s*고정링크 오류\s*(\d+)건\s*·\s*일시 오류\s*(\d+)건/,
  );
  return matched
    ? {
        completed: Number(matched[1]),
        total: Number(matched[1]),
        permanentErrors: Number(matched[2]),
        temporaryErrors: Number(matched[3]),
      }
    : null;
}

function handleMessageMutation() {
  const message = text(
    document.querySelector("#china-link-health-message")?.textContent,
  );
  if (!message) return;
  const progress = parseProgress(message);
  if (progress) {
    writeRun({ status: "running", ...progress });
    return;
  }
  const completed = parseCompletion(message);
  if (completed) {
    writeRun({
      status: "completed",
      ...completed,
      finishedAt: new Date().toISOString(),
    });
    void loadSummary();
    return;
  }
  if (/검사를 중단했습니다/.test(message)) {
    writeRun({ status: "cancelled", finishedAt: new Date().toISOString() });
    void loadSummary();
  }
}

function installObserver() {
  const message = document.querySelector("#china-link-health-message");
  if (!message) return false;
  if (messageObserver) messageObserver.disconnect();
  messageObserver = new MutationObserver(handleMessageMutation);
  messageObserver.observe(message, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  handleMessageMutation();
  return true;
}

function handleAuditClick(event) {
  const button =
    event.target instanceof Element
      ? event.target.closest("button[data-health-action]")
      : null;
  if (!(button instanceof HTMLButtonElement)) return;
  const action = button.dataset.healthAction;
  if (action !== "audit-due" && action !== "audit-all") return;

  const version = collectorVersion();
  if (!versionAtLeast(version, REQUIRED_COLLECTOR_VERSION)) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const message = document.querySelector("#china-link-health-message");
    if (message) {
      message.textContent = `Collector ${REQUIRED_COLLECTOR_VERSION}로 업데이트한 뒤 검사하세요.`;
    }
    renderCollectorRequirement();
    return;
  }

  writeRun({
    status: "running",
    scope: action === "audit-all" ? "all" : "due",
    completed: 0,
    total: 0,
    permanentErrors: 0,
    temporaryErrors: 0,
    startedAt: new Date().toISOString(),
  });
}

function scheduleInstall() {
  renderCollectorRequirement();
  renderStatus();
  if (installObserver()) {
    void loadSummary();
    return;
  }
  if (installAttempts >= 80) return;
  installAttempts += 1;
  installTimer = window.setTimeout(scheduleInstall, 100);
}

document.addEventListener("click", handleAuditClick, true);
window.addEventListener("storage", (event) => {
  if (event.key === RUN_KEY) renderStatus();
});
window.addEventListener(
  "pagehide",
  () => {
    const run = activeRun();
    if (run) {
      writeRun({ status: "interrupted", finishedAt: new Date().toISOString() });
    }
    if (messageObserver) messageObserver.disconnect();
    if (installTimer) window.clearTimeout(installTimer);
    document.removeEventListener("click", handleAuditClick, true);
  },
  { once: true },
);

scheduleInstall();

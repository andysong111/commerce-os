const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const ENGINE_CONFIG_API = "/api/product-launch-tracker/detail-page-engine-config";
const ASSET_UPLOAD_API = "/api/product-launch-tracker/detail-page-assets";
const MESSAGE_SOURCE = "commerce-os-detail-page-studio";
const ACTIVE_TIMEOUT_MS = 45 * 60 * 1000;
const REPRESENTATIVE_ROLE_TO_DOCK_ROLE = Object.freeze({
  main_catalog: "main",
  alternate_whole: "additional-1",
  evidence_detail: "additional-2",
  lifestyle_usage: "additional-3",
  adaptive_support: "additional-4",
});

const bulkControls = document.querySelector(".bulk-controls");
const tableBody = document.querySelector("#launch-table-body");
let runButton = null;
let monitor = null;
let queue = [];
let active = null;
let activeFrame = null;
let activeTimer = null;
let engineConfig = null;

installStyles();
installControls();
restoreMonitor();
window.addEventListener("message", handleEngineMessage);

if (tableBody) {
  new MutationObserver(syncRunButton).observe(tableBody, {
    childList: true,
    subtree: true,
  });
}
document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") return;
  if (target.id === "select-visible" || target.closest("#launch-table-body")) {
    window.setTimeout(syncRunButton, 0);
  }
}, true);

function installControls() {
  if (!bulkControls || bulkControls.querySelector("#detail-page-dock-run-button")) return;
  runButton = document.createElement("button");
  runButton.id = "detail-page-dock-run-button";
  runButton.type = "button";
  runButton.className = "button button-primary";
  runButton.title = "체크한 상품의 중국링크 고정1번으로 상세페이지와 대표·부가 이미지를 생성합니다.";
  runButton.addEventListener("click", () => void enqueueSelected());
  const clear = bulkControls.querySelector("#clear-selection-button");
  if (clear) clear.before(runButton);
  else bulkControls.append(runButton);
  syncRunButton();
}

function syncRunButton() {
  if (!runButton) return;
  const count = selectedRowIds().length;
  runButton.disabled = count === 0;
  runButton.textContent = count
    ? `선택 상세페이지 생성 (${count}건)`
    : "선택 상세페이지 생성";
}

async function enqueueSelected() {
  const selectedIds = selectedRowIds();
  const state = readState();
  if (!selectedIds.length || !state?.items) return;
  const selected = state.items.filter((item) => selectedIds.includes(String(item.id)));
  const invalid = selected.filter((item) => !readPrimaryChinaLink(item));
  if (invalid.length) {
    showMessage(
      `${invalid.map((item) => item.modelNumber || item.productName || item.id).join(", ")} 상품에 중국링크 고정1번이 없습니다.`,
    );
    return;
  }
  if (!window.confirm(
    `선택한 ${selected.length}개 상품의 상세페이지·대표 1장·부가 4장을 순서대로 생성할까요? 생성 중에도 다른 화면 작업을 계속할 수 있습니다.`,
  )) return;

  ensureMonitor();
  const existing = new Set([
    ...queue.map((job) => job.itemId),
    ...(active ? [active.itemId] : []),
  ]);
  const now = new Date().toISOString();
  for (const item of selected) {
    const itemId = String(item.id);
    if (existing.has(itemId)) continue;
    const job = {
      itemId,
      jobId: crypto.randomUUID(),
      sourceUrl: readPrimaryChinaLink(item),
      productName: String(item.productName || item.modelNumber || "상품"),
      salesOptions: readSalesOptions(item),
      attempt: Number(item.detailPageAutomation?.attempt || 0) + 1,
    };
    queue.push(job);
    patchItem(itemId, {
      detailPageAutomation: {
        jobId: job.jobId,
        status: "queued",
        stage: "queued",
        message: "생성 대기 중",
        progress: 0,
        qaStatus: "pending",
        sourceUrl: job.sourceUrl,
        attempt: job.attempt,
        queuedAt: now,
        startedAt: null,
        completedAt: null,
        error: "",
      },
    });
  }
  renderMonitor();
  void processNext();
}

async function processNext() {
  if (active || queue.length === 0) return;
  active = queue.shift();
  updateAutomation(active.itemId, {
    status: "running",
    stage: "engine_start",
    message: "상세페이지 엔진 연결 중",
    progress: 2,
    qaStatus: "pending",
    startedAt: new Date().toISOString(),
    error: "",
  });
  renderMonitor();
  try {
    const config = await getEngineConfig();
    const url = new URL(config.engineUrl);
    url.searchParams.set("ops_dock", "1");
    url.searchParams.set("job_id", active.jobId);
    url.searchParams.set("item_id", active.itemId);
    url.searchParams.set("target_origin", window.location.origin);
    url.searchParams.set("source_url", active.sourceUrl);
    if (active.salesOptions) url.searchParams.set("sales_options", active.salesOptions);

    activeFrame = document.createElement("iframe");
    activeFrame.id = "detail-page-dock-engine-frame";
    activeFrame.title = "상세페이지 자동 생성 엔진";
    activeFrame.src = url.toString();
    activeFrame.setAttribute("aria-hidden", "true");
    document.body.append(activeFrame);
    activeTimer = window.setTimeout(() => {
      failActive("상세페이지 생성 시간이 45분을 초과했습니다.", "timeout");
    }, ACTIVE_TIMEOUT_MS);
  } catch (error) {
    failActive(error instanceof Error ? error.message : "상세페이지 엔진을 열지 못했습니다.", "engine_start");
  }
}

async function handleEngineMessage(event) {
  if (!active || !activeFrame || event.source !== activeFrame.contentWindow) return;
  if (!engineConfig || event.origin !== engineConfig.engineOrigin) return;
  const payload = event.data;
  if (!payload || payload.source !== MESSAGE_SOURCE || payload.jobId !== active.jobId) return;

  if (payload.type === "ops-dock-progress") {
    updateAutomation(active.itemId, {
      status: "running",
      stage: cleanText(payload.stage, 80) || "running",
      message: cleanText(payload.message, 240) || "생성 중",
      progress: clamp(Number(payload.progress) || 0, 1, 99),
      qaStatus: payload.qaStatus === "passed" ? "passed" : "pending",
    });
    renderMonitor();
    return;
  }
  if (payload.type === "ops-dock-failed") {
    failActive(cleanText(payload.message, 500) || "상세페이지 엔진 실행에 실패했습니다.", cleanText(payload.stage, 80));
    return;
  }
  if (payload.type !== "ops-dock-complete") return;

  try {
    updateAutomation(active.itemId, {
      status: "uploading",
      stage: "asset_upload",
      message: "검수 통과 결과를 OPS 저장소에 연결 중",
      progress: 93,
      qaStatus: "passed",
    });
    renderMonitor();
    const docked = await uploadResult(active, payload);
    const now = new Date().toISOString();
    patchItem(active.itemId, (item) => ({
      detailPageAsset: {
        ...item.detailPageAsset,
        status: "ready",
        resultId: active.jobId,
        html: buildDetailHtml(docked.detailImageUrl, payload.productName || active.productName),
        detailImageUrl: docked.detailImageUrl,
        mainImageUrl: docked.mainImageUrl,
        additionalImageUrls: docked.additionalImageUrls,
        syncedAt: now,
      },
      detailPageAutomation: {
        ...item.detailPageAutomation,
        status: "completed",
        stage: "docked",
        message: "검수 통과 · 상세 HTML과 이미지 URL 자동 도킹 완료",
        progress: 100,
        qaStatus: "passed",
        completedAt: now,
        error: "",
      },
      stages: {
        ...item.stages,
        detailPage: {
          ...item.stages?.detailPage,
          status: "완료",
          completedAt: now,
          note: "상세페이지 엔진 자동 생성·검수 통과 후 결과 도킹",
        },
      },
      updatedAt: now,
      updatedBy: "상세페이지 자동 도킹",
    }));
    finishActive();
  } catch (error) {
    failActive(error instanceof Error ? error.message : "생성 결과를 저장하지 못했습니다.", "asset_upload");
  }
}

async function uploadResult(job, payload) {
  if (
    payload.qa?.detailPassed !== true ||
    payload.qa?.representativeIndividualsPassed !== true
  ) {
    throw new Error("상세페이지 또는 대표·부가 이미지 품질검수 통과 정보가 없습니다.");
  }
  if (!payload.detail?.base64 || !Array.isArray(payload.representative) || payload.representative.length !== 5) {
    throw new Error("상세페이지 엔진이 전달한 결과 이미지 6장이 올바르지 않습니다.");
  }
  const uploads = [
    { role: "detail-page", image: payload.detail },
    ...payload.representative.map((image) => ({
      role: REPRESENTATIVE_ROLE_TO_DOCK_ROLE[image.roleId] || "",
      image,
    })),
  ];
  if (uploads.some((upload) => !upload.role) || new Set(uploads.map((upload) => upload.role)).size !== 6) {
    throw new Error("대표·부가 이미지의 역할 구성이 올바르지 않습니다.");
  }
  const urls = {};
  for (let index = 0; index < uploads.length; index += 1) {
    const upload = uploads[index];
    updateAutomation(job.itemId, {
      message: `결과 이미지 저장 ${index + 1}/${uploads.length}`,
      progress: 93 + Math.round(((index + 1) / uploads.length) * 6),
    });
    renderMonitor();
    urls[upload.role] = await uploadOne(job, upload.role, upload.image);
  }
  const additionalImageUrls = [1, 2, 3, 4]
    .map((index) => urls[`additional-${index}`])
    .filter(Boolean);
  if (!urls["detail-page"] || !urls.main || additionalImageUrls.length !== 4) {
    throw new Error("저장된 상세·대표·부가 이미지 URL 구성이 완전하지 않습니다.");
  }
  return {
    detailImageUrl: urls["detail-page"],
    mainImageUrl: urls.main,
    additionalImageUrls,
  };
}

async function uploadOne(job, role, image) {
  const body = new FormData();
  body.set("item_id", job.itemId);
  body.set("job_id", job.jobId);
  body.set("role", role);
  body.set("file", base64File(image.base64, image.mimeType || "image/jpeg", `${role}.jpg`));
  const response = await fetch(ASSET_UPLOAD_API, {
    method: "POST",
    body,
    credentials: "same-origin",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true || !payload.publicUrl) {
    throw new Error(payload.message || `결과 이미지 저장에 실패했습니다. (${role})`);
  }
  return payload.publicUrl;
}

function failActive(message, stage = "failed") {
  if (!active) return;
  updateAutomation(active.itemId, {
    status: "failed",
    stage: stage || "failed",
    message: "생성 실패 · 다시 생성할 수 있습니다.",
    qaStatus: "failed",
    error: message,
    completedAt: new Date().toISOString(),
  });
  finishActive();
}

function finishActive() {
  window.clearTimeout(activeTimer);
  activeTimer = null;
  activeFrame?.remove();
  activeFrame = null;
  active = null;
  renderMonitor();
  window.setTimeout(() => void processNext(), 250);
}

function retryItem(itemId) {
  const state = readState();
  const item = state?.items?.find((candidate) => String(candidate.id) === String(itemId));
  const sourceUrl = readPrimaryChinaLink(item);
  if (!item || !sourceUrl) {
    showMessage("중국링크 고정1번을 확인한 뒤 다시 생성하세요.");
    return;
  }
  if (active?.itemId === String(itemId) || queue.some((job) => job.itemId === String(itemId))) return;
  const job = {
    itemId: String(itemId),
    jobId: crypto.randomUUID(),
    sourceUrl,
    productName: String(item.productName || item.modelNumber || "상품"),
    salesOptions: readSalesOptions(item),
    attempt: Number(item.detailPageAutomation?.attempt || 0) + 1,
  };
  queue.push(job);
  patchItem(job.itemId, {
    detailPageAutomation: {
      ...item.detailPageAutomation,
      jobId: job.jobId,
      status: "queued",
      stage: "queued",
      message: "다시 생성 대기 중",
      progress: 0,
      qaStatus: "pending",
      sourceUrl,
      attempt: job.attempt,
      queuedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      error: "",
    },
  });
  ensureMonitor();
  renderMonitor();
  void processNext();
}

function restoreMonitor() {
  const state = readState();
  const hasHistory = state?.items?.some((item) => item.detailPageAutomation?.jobId);
  if (hasHistory) {
    const interruptedAt = new Date().toISOString();
    const interruptedStatuses = new Set(["queued", "running", "uploading"]);
    let changed = false;
    state.items = state.items.map((item) => {
      if (!interruptedStatuses.has(item.detailPageAutomation?.status)) return item;
      changed = true;
      return {
        ...item,
        detailPageAutomation: {
          ...item.detailPageAutomation,
          status: "failed",
          stage: "browser_interrupted",
          message: "브라우저 새로고침 또는 화면 이동으로 생성이 중단되었습니다.",
          qaStatus: "failed",
          completedAt: interruptedAt,
          error: "중국링크 고정1번을 유지한 채 ‘다시 생성’을 누르면 이어서 만들 수 있습니다.",
        },
        updatedAt: interruptedAt,
      };
    });
    if (changed) {
      state.savedAt = interruptedAt;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      window.dispatchEvent(new CustomEvent("product-launch-tracker:external-state"));
    }
    ensureMonitor();
    renderMonitor();
  }
}

function ensureMonitor() {
  if (monitor) return monitor;
  monitor = document.createElement("aside");
  monitor.id = "detail-page-dock-monitor";
  monitor.innerHTML = `
    <div class="dock-monitor-header">
      <div><strong>상세페이지 자동 생성</strong><span id="dock-monitor-summary"></span></div>
      <button type="button" id="dock-monitor-toggle" aria-label="진행창 접기">−</button>
    </div>
    <div id="dock-monitor-body">
      <div id="dock-monitor-jobs"></div>
      <div class="dock-monitor-footer">
        <button type="button" id="dock-retry-failed">실패 작업 다시 생성</button>
      </div>
    </div>`;
  document.body.append(monitor);
  monitor.querySelector("#dock-monitor-toggle")?.addEventListener("click", () => {
    monitor.classList.toggle("is-collapsed");
    const button = monitor.querySelector("#dock-monitor-toggle");
    if (button) button.textContent = monitor.classList.contains("is-collapsed") ? "+" : "−";
  });
  monitor.querySelector("#dock-retry-failed")?.addEventListener("click", () => {
    const state = readState();
    for (const item of state?.items || []) {
      if (item.detailPageAutomation?.status === "failed") retryItem(item.id);
    }
  });
  monitor.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-retry-item]");
    if (button) retryItem(button.dataset.retryItem);
    const detail = event.target.closest("button[data-open-item]");
    if (detail) {
      document.querySelector(`tr[data-id='${cssEscape(detail.dataset.openItem)}'] button[data-action='detail']`)?.click();
    }
  });
  return monitor;
}

function renderMonitor() {
  if (!monitor) return;
  const state = readState();
  const items = (state?.items || [])
    .filter((item) => item.detailPageAutomation?.jobId)
    .sort((left, right) => Date.parse(right.detailPageAutomation?.queuedAt || 0) - Date.parse(left.detailPageAutomation?.queuedAt || 0))
    .slice(0, 8);
  const runningCount = items.filter((item) => ["queued", "running", "uploading"].includes(item.detailPageAutomation?.status)).length;
  const failedCount = items.filter((item) => item.detailPageAutomation?.status === "failed").length;
  const summary = monitor.querySelector("#dock-monitor-summary");
  if (summary) summary.textContent = runningCount ? `진행 ${runningCount}건` : failedCount ? `실패 ${failedCount}건` : "대기 작업 없음";
  const body = monitor.querySelector("#dock-monitor-jobs");
  if (!body) return;
  body.innerHTML = items.length ? items.map((item) => {
    const job = item.detailPageAutomation || {};
    const status = job.status || "queued";
    const label = {
      queued: "대기",
      running: "생성 중",
      uploading: "도킹 중",
      completed: "완료",
      failed: "실패",
    }[status] || status;
    return `<article class="dock-job dock-status-${escapeAttribute(status)}">
      <div class="dock-job-title"><strong>${escapeHtml(item.modelNumber || item.productName || item.id)}</strong><span>${label}</span></div>
      <p>${escapeHtml(job.message || "생성 대기 중")}</p>
      <div class="dock-progress"><i style="width:${clamp(Number(job.progress) || 0, 0, 100)}%"></i></div>
      ${job.error ? `<p class="dock-error">${escapeHtml(job.error)}</p>` : ""}
      <div class="dock-job-meta">시도 ${Number(job.attempt || 1)}회 · 검수 ${job.qaStatus === "passed" ? "통과" : job.qaStatus === "failed" ? "실패" : "진행 중"}</div>
      <div class="dock-job-actions">
        <button type="button" data-open-item="${escapeAttribute(item.id)}">상품 상세</button>
        ${["failed", "completed"].includes(status) ? `<button type="button" data-retry-item="${escapeAttribute(item.id)}">다시 생성</button>` : ""}
      </div>
    </article>`;
  }).join("") : '<p class="dock-empty">생성 작업이 없습니다.</p>';
  const retry = monitor.querySelector("#dock-retry-failed");
  if (retry) retry.disabled = failedCount === 0;
}

async function getEngineConfig() {
  if (engineConfig) return engineConfig;
  const response = await fetch(ENGINE_CONFIG_API, { cache: "no-store", credentials: "same-origin" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok !== true || !payload.engineUrl || !payload.engineOrigin) {
    throw new Error(payload.message || "상세페이지 엔진 연결 설정을 읽지 못했습니다.");
  }
  engineConfig = payload;
  return payload;
}

function selectedRowIds() {
  return [...document.querySelectorAll("#launch-table-body tr[data-id] input.row-check:checked")]
    .map((input) => String(input.closest("tr[data-id]")?.dataset.id || ""))
    .filter(Boolean);
}

function readPrimaryChinaLink(item) {
  return String(item?.primaryChinaProductLink || item?.detailPageSource?.primaryUrl || item?.chinaProductLinks?.[0] || "").trim();
}

function readSalesOptions(item) {
  return (Array.isArray(item?.orderOptions) ? item.orderOptions : [])
    .map((option) => String(option?.saleOption || "").trim())
    .filter(Boolean)
    .join(" / ")
    .slice(0, 2000);
}

function readState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function patchItem(itemId, patch) {
  const state = readState();
  if (!state?.items) return;
  const now = new Date().toISOString();
  state.items = state.items.map((item) => {
    if (String(item.id) !== String(itemId)) return item;
    const changes = typeof patch === "function" ? patch(item) : patch;
    return { ...item, ...changes, updatedAt: changes.updatedAt || now };
  });
  state.savedAt = now;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("product-launch-tracker:external-state"));
}

function updateAutomation(itemId, patch) {
  patchItem(itemId, (item) => ({
    detailPageAutomation: { ...item.detailPageAutomation, ...patch },
  }));
}

function buildDetailHtml(url, productName) {
  const safeUrl = escapeAttribute(url);
  const safeName = escapeAttribute(productName || "상품 상세페이지");
  return `<div style="margin:0 auto;max-width:1000px;text-align:center;"><img src="${safeUrl}" alt="${safeName}" style="display:block;width:100%;height:auto;margin:0 auto;" loading="lazy"></div>`;
}

function base64File(base64, mimeType, name) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name, { type: mimeType });
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function cssEscape(value) {
  return window.CSS?.escape ? window.CSS.escape(String(value || "")) : String(value || "").replace(/['\\]/g, "\\$&");
}

function showMessage(message) {
  const toast = document.querySelector("#toast");
  if (toast) {
    toast.textContent = message;
    toast.classList.add("show");
    window.setTimeout(() => toast.classList.remove("show"), 3200);
  } else window.alert(message);
}

function installStyles() {
  const style = document.createElement("style");
  style.id = "detail-page-dock-styles";
  style.textContent = `
    #detail-page-dock-engine-frame{position:fixed!important;left:-20px!important;bottom:-20px!important;width:1px!important;height:1px!important;opacity:.01!important;border:0!important;pointer-events:none!important}
    #detail-page-dock-monitor{position:fixed;right:18px;bottom:18px;z-index:70;width:min(390px,calc(100vw - 36px));max-height:min(620px,calc(100vh - 36px));overflow:hidden;border:1px solid #cbd5e1;border-radius:16px;background:#fff;box-shadow:0 18px 48px rgba(15,23,42,.24);font-size:13px;color:#0f172a}
    .dock-monitor-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 14px;background:#0f172a;color:#fff}.dock-monitor-header div{display:flex;flex-direction:column;gap:2px}.dock-monitor-header span{font-size:11px;color:#cbd5e1}.dock-monitor-header button{width:28px;height:28px;border:0;border-radius:8px;background:#334155;color:#fff;font-weight:900;cursor:pointer}
    #dock-monitor-body{max-height:540px;overflow:auto;padding:10px;background:#f8fafc}.is-collapsed #dock-monitor-body{display:none}.dock-job{margin-bottom:9px;padding:11px;border:1px solid #e2e8f0;border-left:4px solid #2563eb;border-radius:10px;background:#fff}.dock-status-completed{border-left-color:#059669}.dock-status-failed{border-left-color:#dc2626}.dock-job-title{display:flex;justify-content:space-between;gap:10px}.dock-job-title span{font-size:11px;font-weight:800}.dock-job p{margin:6px 0 0;line-height:1.45;color:#475569}.dock-progress{height:6px;margin-top:8px;overflow:hidden;border-radius:999px;background:#e2e8f0}.dock-progress i{display:block;height:100%;border-radius:inherit;background:#2563eb;transition:width .25s}.dock-status-completed .dock-progress i{background:#059669}.dock-status-failed .dock-progress i{background:#dc2626}.dock-error{color:#b91c1c!important}.dock-job-meta{margin-top:7px;font-size:11px;color:#64748b}.dock-job-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:8px}.dock-job-actions button,.dock-monitor-footer button{min-height:30px;border:1px solid #cbd5e1;border-radius:7px;background:#fff;padding:0 9px;font:inherit;font-weight:800;cursor:pointer}.dock-monitor-footer{display:flex;justify-content:flex-end;padding-top:2px}.dock-monitor-footer button:disabled{opacity:.45;cursor:not-allowed}.dock-empty{padding:18px;text-align:center;color:#64748b}
  `;
  document.head.append(style);
}

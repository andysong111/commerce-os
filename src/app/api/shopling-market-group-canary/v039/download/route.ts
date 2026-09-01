import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV038Package } from "../../v038/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.9";
const SELECTION_BRIDGE = "shopling-market-selection-v0.1";
const SELECTED_CLAIM_MESSAGE = "commerce-os-shopling-selected-claim-v039";
const SELECTED_START_MESSAGE = "commerce-os-shopling-selected-market-start-v039";
const SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV039";

function replaceOnce(source: string, anchor: string, replacement: string, code: string) {
  const first = source.indexOf(anchor);
  if (first < 0) throw new Error(code);
  if (source.indexOf(anchor, first + anchor.length) >= 0) throw new Error(`${code}_ambiguous`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}

function assertScript(name: string, source: string) {
  try {
    new Function(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "syntax error");
    throw new Error(`shopling_market_sender_${name}_invalid: ${message}`);
  }
}

function rewriteBackground(source: string) {
  let rewritten = source
    .replaceAll("commerceOsShoplingParallelWorkerMetaV038", "commerceOsShoplingParallelWorkerMetaV039")
    .replaceAll("v038", "v039");

  rewritten = replaceOnce(
    rewritten,
    'const CONTEXT_MESSAGE = "commerce-os-shopling-parallel-worker-context";',
    `const CONTEXT_MESSAGE = "commerce-os-shopling-parallel-worker-context";\nconst SELECTED_CLAIM_MESSAGE = "${SELECTED_CLAIM_MESSAGE}";\nconst SELECTED_CLAIM_API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/selection/claim";\nconst SELECTED_BRIDGE = "${SELECTION_BRIDGE}";`,
    "v039_background_selected_constants_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `function claimApi(runId, rawVisibleGoodsKeys) {\n  const visibleGoodsKeys = normalizeVisibleGoodsKeys(rawVisibleGoodsKeys);\n  return requestJson(CLAIM_API_ENDPOINT, { bridge: CLAIM_API_BRIDGE, runId, visibleGoodsKeys });\n}`,
    `function claimApi(runId, rawVisibleGoodsKeys) {\n  const visibleGoodsKeys = normalizeVisibleGoodsKeys(rawVisibleGoodsKeys);\n  return requestJson(CLAIM_API_ENDPOINT, { bridge: CLAIM_API_BRIDGE, runId, visibleGoodsKeys });\n}\n\nfunction selectedClaimApi(runId, jobId, excludeGoodsKeys) {\n  return requestJson(SELECTED_CLAIM_API_ENDPOINT, {\n    bridge: SELECTED_BRIDGE,\n    runId,\n    jobId: text(jobId),\n    maxTasks: 3,\n    excludeGoodsKeys: Array.isArray(excludeGoodsKeys) ? excludeGoodsKeys.map(text) : [],\n  });\n}`,
    "v039_background_selected_claim_api_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  if (message.type === OPEN_WORKERS_MESSAGE) {`,
    `  if (message.type === SELECTED_CLAIM_MESSAGE) {\n    selectedClaimApi(runId, message.jobId, message.excludeGoodsKeys).then(sendResponse).catch((error) => sendResponse({\n      ok: false,\n      error: "selected_shopling_claim_exception",\n      message: String(error?.message || error),\n    }));\n    return true;\n  }\n\n  if (message.type === OPEN_WORKERS_MESSAGE) {`,
    "v039_background_selected_claim_listener_anchor_missing",
  );

  assertScript("background-v039", rewritten);
  return rewritten;
}

const SELECTION_COORDINATOR = `
  async function getSelectionQueue() {
    const stored = await storageGet(SELECTION_QUEUE_KEY);
    return stored?.[SELECTION_QUEUE_KEY] || null;
  }

  async function saveSelectionQueue(queue) {
    await storageSet({ [SELECTION_QUEUE_KEY]: queue });
    return queue;
  }

  function selectedJobIds(raw) {
    return [...new Set((Array.isArray(raw) ? raw : [])
      .map((value) => text(value))
      .filter((value) => /^[0-9a-f-]{36}$/i.test(value)))].slice(0, 20);
  }

  function selectedRunResult(queue, summary, errorMessage = "") {
    const successCount = Number(summary?.successCount || 0);
    const confirmNeededCount = Number(summary?.confirmNeededCount || 0);
    const pendingCount = Number(summary?.pendingCount || 0);
    const busyCount = Number(summary?.busyCount || 0);
    const excludedPendingCount = Number(summary?.excludedPendingCount || 0);
    const status = errorMessage || confirmNeededCount > 0 || pendingCount > 0 || busyCount > 0
      ? "exception"
      : "completed";
    return {
      jobId: queue.jobIds[queue.cursor],
      status,
      successCount,
      confirmNeededCount,
      pendingCount,
      busyCount,
      excludedPendingCount,
      error: errorMessage,
      finishedAt: Date.now(),
    };
  }

  async function selectedWaveStates(queue) {
    const activeTasks = Array.isArray(queue?.activeTasks) ? queue.activeTasks : [];
    if (!queue?.activeRunId || !activeTasks.length) return [];
    return (await Promise.all(activeTasks.map((task) => getWorkerState(queue.activeRunId, task.goodsKey)))).filter(Boolean);
  }

  async function finishSelectionQueue(queue) {
    const results = Array.isArray(queue.results) ? queue.results : [];
    const hasException = results.some((row) => row?.status !== "completed");
    return saveSelectionQueue({
      ...queue,
      status: hasException ? "completed_with_exceptions" : "completed",
      activeRunId: "",
      activeTasks: [],
      finishedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  async function selectedCoordinatorTick() {
    if (selectionCoordinating) return;
    selectionCoordinating = true;
    try {
      const context = await workerContext();
      if (context.worker || window.top !== window || !isProductListUi()) return;
      let queue = await getSelectionQueue();
      if (!queue || queue.status !== "running") return;

      if (queue.activeRunId) {
        const states = await selectedWaveStates(queue);
        if (states.some((state) => state.status === "running")) return;
        const wave = {
          runId: queue.activeRunId,
          jobId: queue.jobIds[queue.cursor],
          taskCount: Array.isArray(queue.activeTasks) ? queue.activeTasks.length : 0,
          sent: states.filter((state) => state.status === "completed" && state.outcome === "sent").length,
          alreadyRegistered: states.filter((state) => state.status === "completed" && state.outcome === "already_registered").length,
          failed: states.filter((state) => state.status === "failed").length,
          confirmNeeded: states.filter((state) => state.status === "confirm_needed").length,
          finishedAt: Date.now(),
        };
        queue = await saveSelectionQueue({
          ...queue,
          activeRunId: "",
          activeTasks: [],
          waves: [...(Array.isArray(queue.waves) ? queue.waves : []), wave],
          updatedAt: Date.now(),
        });
      }

      if (queue.cursor >= queue.jobIds.length) {
        await finishSelectionQueue(queue);
        return;
      }

      const jobId = queue.jobIds[queue.cursor];
      const attemptedGoodsKeys = Array.isArray(queue.attemptedGoodsKeys) ? queue.attemptedGoodsKeys : [];
      const runId = newRunId();
      const claim = await sendMessage({
        type: SELECTED_CLAIM_MESSAGE,
        runId,
        jobId,
        excludeGoodsKeys: attemptedGoodsKeys,
      });

      if (!claim?.ok) {
        const result = selectedRunResult(queue, null, text(claim?.message || claim?.error || "선택 상품 작업 확보 실패"));
        queue = await saveSelectionQueue({
          ...queue,
          cursor: queue.cursor + 1,
          attemptedGoodsKeys: [],
          results: [...(Array.isArray(queue.results) ? queue.results : []), result],
          updatedAt: Date.now(),
        });
        setTimeout(() => void selectedCoordinatorTick(), 150);
        return;
      }

      const tasks = Array.isArray(claim.tasks) ? claim.tasks : [];
      if (!tasks.length) {
        const result = selectedRunResult(queue, claim.summary || {});
        queue = await saveSelectionQueue({
          ...queue,
          cursor: queue.cursor + 1,
          attemptedGoodsKeys: [],
          results: [...(Array.isArray(queue.results) ? queue.results : []), result],
          updatedAt: Date.now(),
        });
        if (queue.cursor >= queue.jobIds.length) await finishSelectionQueue(queue);
        else setTimeout(() => void selectedCoordinatorTick(), 150);
        return;
      }

      await initializeWorkerStates(runId, tasks);
      const nextAttempted = [...new Set([...attemptedGoodsKeys, ...tasks.map((task) => task.goodsKey)])];
      queue = await saveSelectionQueue({
        ...queue,
        activeRunId: runId,
        activeTasks: tasks,
        activeJobId: jobId,
        activeModelNumber: text(tasks[0]?.modelNumber),
        attemptedGoodsKeys: nextAttempted,
        updatedAt: Date.now(),
      });

      const opened = await sendMessage({ type: OPEN_WORKERS_MESSAGE, runId, tasks });
      if (!opened?.ok) {
        const states = await Promise.all(tasks.map((task) => getWorkerState(runId, task.goodsKey)));
        for (const state of states.filter(Boolean)) {
          await patchWorkerState(state, {
            status: "failed",
            stage: "worker_open_failed",
            message: \`병렬 A18 작업창 생성 실패: \${text(opened?.message || opened?.error)}\`,
          });
        }
        await saveSelectionQueue({ ...queue, updatedAt: Date.now() });
        setTimeout(() => void selectedCoordinatorTick(), 250);
        return;
      }

      for (const failure of Array.isArray(opened.failed) ? opened.failed : []) {
        const failedState = await getWorkerState(runId, failure.goodsKey);
        if (failedState) {
          await patchWorkerState(failedState, {
            status: failure.released ? "failed" : "confirm_needed",
            stage: "worker_open_failed",
            message: \`\${failure.profile} 복제창 생성 실패: \${text(failure.message || failure.error)}\`,
          });
        }
      }
    } catch (error) {
      const queue = await getSelectionQueue();
      if (queue?.status === "running") {
        const result = selectedRunResult(queue, null, error instanceof Error ? error.message : String(error || "선택 등록 오류"));
        await saveSelectionQueue({
          ...queue,
          cursor: queue.cursor + 1,
          activeRunId: "",
          activeTasks: [],
          attemptedGoodsKeys: [],
          results: [...(Array.isArray(queue.results) ? queue.results : []), result],
          updatedAt: Date.now(),
        });
      }
    } finally {
      selectionCoordinating = false;
    }
  }

  async function startSelectedQueue(rawJobIds) {
    const jobIds = selectedJobIds(rawJobIds);
    if (!jobIds.length) return { ok: false, error: "selected_shopling_jobs_required" };
    const existing = await getSelectionQueue();
    if (existing?.status === "running") {
      return { ok: false, error: "selected_shopling_queue_already_running", message: "이미 선택 상품 마켓등록이 실행 중입니다." };
    }
    const now = Date.now();
    await saveSelectionQueue({
      version: VERSION,
      status: "running",
      jobIds,
      cursor: 0,
      activeRunId: "",
      activeJobId: "",
      activeModelNumber: "",
      activeTasks: [],
      attemptedGoodsKeys: [],
      results: [],
      waves: [],
      startedAt: now,
      updatedAt: now,
    });
    await selectedCoordinatorTick();
    return { ok: true, version: VERSION, selectedCount: jobIds.length };
  }
`;

function rewriteContent(source: string) {
  let rewritten = source
    .replaceAll("0.3.8", VERSION)
    .replaceAll("V038", "V039")
    .replaceAll("v038", "v039");

  rewritten = replaceOnce(
    rewritten,
    `  const CONTROL_START_MESSAGE = "commerce-os-shopling-parallel-control-start-v039";`,
    `  const CONTROL_START_MESSAGE = "commerce-os-shopling-parallel-control-start-v039";\n  const SELECTED_CLAIM_MESSAGE = "${SELECTED_CLAIM_MESSAGE}";\n  const SELECTED_START_MESSAGE = "${SELECTED_START_MESSAGE}";\n  const SELECTION_QUEUE_KEY = "${SELECTION_QUEUE_KEY}";`,
    "v039_content_selected_constants_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  let driving = false;\n  let timer = null;\n  let panelTimer = null;`,
    `  let driving = false;\n  let timer = null;\n  let panelTimer = null;\n  let selectionCoordinating = false;`,
    "v039_content_selected_state_anchor_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  function mount() {`,
    `${SELECTION_COORDINATOR}\n  function mount() {`,
    "v039_content_coordinator_anchor_missing",
  );

  const oldListener = `  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {\n    if (!message || message.type !== CONTROL_START_MESSAGE || !isProductListUi()) return false;\n    startParallelCanary()\n      .then(() => sendResponse({ ok: true, version: VERSION }))\n      .catch((error) => sendResponse({ ok: false, error: "parallel_control_start_failed", message: error instanceof Error ? error.message : String(error || "start failed") }));\n    return true;\n  });`;
  const newListener = `  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {\n    if (!message || window.top !== window || !isProductListUi()) return false;\n    if (message.type === SELECTED_START_MESSAGE) {\n      startSelectedQueue(message.jobIds)\n        .then(sendResponse)\n        .catch((error) => sendResponse({ ok: false, error: "selected_shopling_start_failed", message: error instanceof Error ? error.message : String(error || "start failed") }));\n      return true;\n    }\n    if (message.type === CONTROL_START_MESSAGE) {\n      startParallelCanary()\n        .then(() => sendResponse({ ok: true, version: VERSION }))\n        .catch((error) => sendResponse({ ok: false, error: "parallel_control_start_failed", message: error instanceof Error ? error.message : String(error || "start failed") }));\n      return true;\n    }\n    return false;\n  });`;
  rewritten = replaceOnce(rewritten, oldListener, newListener, "v039_content_control_listener_anchor_missing");

  rewritten = replaceOnce(
    rewritten,
    `  panelTimer = null;\n  void drive();`,
    `  panelTimer = setInterval(() => void selectedCoordinatorTick(), 1200);\n  void drive();\n  void selectedCoordinatorTick();`,
    "v039_content_coordinator_timer_anchor_missing",
  );

  assertScript("content-v039", rewritten);
  return rewritten;
}

const POPUP_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shopling Market Sender</title>
<style>
*{box-sizing:border-box}body{width:460px;margin:0;padding:14px;font:13px/1.45 Arial,sans-serif;color:#0f172a;background:#fff}h1{font-size:15px;margin:0;color:#0f766e}.sub{margin:4px 0 10px;color:#64748b;font-size:12px}.status{padding:9px 10px;border:1px solid #dbeafe;border-radius:8px;background:#f8fafc;margin-bottom:10px}.toolbar{display:flex;align-items:center;gap:8px;margin-bottom:8px}.toolbar button{width:auto;padding:6px 9px;background:#e2e8f0;color:#334155}.list{max-height:390px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px}.item{display:flex;gap:8px;padding:9px;border-bottom:1px solid #eef2f7}.item:last-child{border-bottom:0}.item.disabled{opacity:.55}.title{font-weight:700}.meta{font-size:11px;color:#64748b;margin-top:2px}.warn{color:#b45309}.ok{color:#166534}.danger{color:#b91c1c}.empty{padding:18px;text-align:center;color:#64748b}button{width:100%;padding:10px;border:0;border-radius:8px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer;margin-top:10px}button:disabled{opacity:.5;cursor:default}.foot{font-size:11px;color:#64748b;margin-top:8px}
</style>
</head>
<body>
<h1>Shopling Market Sender v0.3.9</h1>
<div class="sub">Commerce OS SEO 대량등록 → Shopling 업로드 완료 목록에서 직접 선택합니다. A18 화면에 보이는 상품은 대상 선정에 사용하지 않습니다.</div>
<div id="status" class="status">상태 확인 중...</div>
<div class="toolbar"><label><input id="selectAll" type="checkbox"> 선택 가능 전체</label><button id="refresh" type="button">목록 새로고침</button></div>
<div id="list" class="list"><div class="empty">업로드 목록 불러오는 중...</div></div>
<button id="start" type="button" disabled>선택 상품 마켓등록 시작</button>
<div class="foot">상품은 순차 처리 · 상품 1개당 최대 3채널 병렬(3+3) · goods_key + 자사상품코드 이중검증 · 확인필요는 자동 재송신하지 않음</div>
<script src="popup.js"></script>
</body>
</html>`;

const POPUP_JS = `"use strict";
const VERSION = "0.3.9";
const BRIDGE = "${SELECTION_BRIDGE}";
const LIST_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/selection/list";
const START_MESSAGE = "${SELECTED_START_MESSAGE}";
const QUEUE_KEY = "${SELECTION_QUEUE_KEY}";
const statusNode = document.getElementById("status");
const listNode = document.getElementById("list");
const startButton = document.getElementById("start");
const selectAll = document.getElementById("selectAll");
const refreshButton = document.getElementById("refresh");
let items = [];
let queueRunning = false;

function text(value) { return String(value == null ? "" : value).replace(/\\s+/g, " ").trim(); }
function esc(value) { return text(value).replace(/[&<>"']/g, function (char) { return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]; }); }
function dateLabel(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ko-KR", {month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}); }

async function activeA18Tab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !Number.isInteger(tab.id) || !/^https?:\\/\\/a\\.shopling\\.co\\.kr\\//i.test(String(tab.url || ""))) return null;
  return tab;
}

function selectedJobIds() {
  return [...document.querySelectorAll('input[data-job-id]:checked')].map(function (node) { return node.dataset.jobId; }).filter(Boolean);
}

function updateStartButton() {
  const count = selectedJobIds().length;
  startButton.textContent = count ? "선택 " + count + "개 마켓등록 시작" : "선택 상품 마켓등록 시작";
  startButton.disabled = queueRunning || count === 0;
}

function itemState(item) {
  if (item.confirmNeededCount > 0) return '<span class="danger">확인필요 ' + item.confirmNeededCount + '</span>';
  if (item.busyCount > 0) return '<span class="warn">처리중 ' + item.busyCount + '</span>';
  if (item.marketDoneCount >= 6) return '<span class="ok">마켓완료 6/6</span>';
  if (item.uploadSuccessCount < 6) return '<span class="danger">Shopling ' + item.uploadSuccessCount + '/6 · 선택불가</span>';
  return '<span class="warn">마켓 ' + item.marketDoneCount + '/6 · 대기 ' + item.marketPendingCount + '</span>';
}

function renderItems() {
  if (!items.length) {
    listNode.innerHTML = '<div class="empty">최근 SEO 대량등록 Shopling 업로드가 없습니다.</div>';
    selectAll.checked = false;
    updateStartButton();
    return;
  }
  listNode.innerHTML = items.map(function (item) {
    const disabled = !item.selectable || queueRunning;
    return '<label class="item' + (disabled ? ' disabled' : '') + '">' +
      '<input type="checkbox" data-job-id="' + esc(item.jobId) + '" ' + (disabled ? 'disabled' : '') + '>' +
      '<div><div class="title">' + esc(item.modelNumber || '-') + ' · ' + esc(item.modelName || '') + '</div>' +
      '<div class="meta">Shopling ' + item.uploadSuccessCount + '/6 · ' + itemState(item) + ' · ' + esc(dateLabel(item.completedAt)) + '</div></div></label>';
  }).join('');
  document.querySelectorAll('input[data-job-id]').forEach(function (node) { node.addEventListener('change', updateStartButton); });
  updateStartButton();
}

async function refreshQueueStatus() {
  const stored = await chrome.storage.local.get(QUEUE_KEY);
  const queue = stored[QUEUE_KEY] || null;
  queueRunning = queue && queue.status === "running";
  if (!queue) {
    statusNode.textContent = "v" + VERSION + " · 실행 대기";
  } else if (queueRunning) {
    const total = Array.isArray(queue.jobIds) ? queue.jobIds.length : 0;
    const current = Math.min(Number(queue.cursor || 0) + 1, total || 1);
    const active = text(queue.activeModelNumber);
    statusNode.textContent = "실행 중 · 상품 " + current + "/" + total + (active ? " · " + active : "") + " · 창을 닫아도 계속 처리됩니다.";
  } else {
    const results = Array.isArray(queue.results) ? queue.results : [];
    const exceptions = results.filter(function (row) { return row && row.status !== "completed"; }).length;
    statusNode.textContent = queue.status === "completed"
      ? "완료 · 선택 상품 " + results.length + "개 정상 종료"
      : "종료 · " + results.length + "개 처리 · 예외 " + exceptions + "개";
  }
  renderItems();
}

async function loadItems() {
  refreshButton.disabled = true;
  try {
    const response = await fetch(LIST_ENDPOINT + "?bridge=" + encodeURIComponent(BRIDGE), { cache: "no-store" });
    const body = await response.json().catch(function () { return null; });
    if (!response.ok || !body || body.ok !== true) throw new Error(text(body && (body.message || body.error)) || "목록 조회 실패");
    items = Array.isArray(body.items) ? body.items : [];
    renderItems();
    await refreshQueueStatus();
  } catch (error) {
    listNode.innerHTML = '<div class="empty danger">' + esc(error && error.message ? error.message : error) + '</div>';
  } finally {
    refreshButton.disabled = false;
  }
}

selectAll.addEventListener("change", function () {
  document.querySelectorAll('input[data-job-id]:not(:disabled)').forEach(function (node) { node.checked = selectAll.checked; });
  updateStartButton();
});
refreshButton.addEventListener("click", loadItems);
startButton.addEventListener("click", async function () {
  const jobIds = selectedJobIds();
  if (!jobIds.length) return;
  startButton.disabled = true;
  statusNode.textContent = "A18 실행 템플릿 확인 중...";
  const tab = await activeA18Tab();
  if (!tab) {
    statusNode.textContent = "Shopling 관리자 A18 쇼핑몰상품등록 탭을 활성화한 뒤 다시 실행하세요.";
    updateStartButton();
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: START_MESSAGE, jobIds: jobIds }, function (response) {
    const lastError = chrome.runtime.lastError;
    if (lastError || !response || response.ok !== true) {
      statusNode.textContent = text(response && (response.message || response.error)) || "A18 실행 템플릿에 시작 신호를 전달하지 못했습니다. A18을 새로고침하세요.";
      updateStartButton();
      return;
    }
    queueRunning = true;
    statusNode.textContent = "선택 " + jobIds.length + "개 등록 시작 · 상품별 3+3 채널 처리";
    renderItems();
  });
});
chrome.storage.onChanged.addListener(function (changes, area) { if (area === "local" && changes[QUEUE_KEY]) refreshQueueStatus(); });
loadItems();`;

export async function GET() {
  const response = await getV038Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v038_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.8") throw new Error("shopling_market_sender_v039_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "Commerce OS SEO 대량등록의 Shopling 업로드 완료 목록을 체크박스로 선택해 상품별 3+3 채널로 마켓등록하는 내부 운영 확장프로그램입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const background = rewriteBackground(strFromU8(entries["background-root.mjs"]));
  const content = rewriteContent(strFromU8(entries["content-group-canary.mjs"]));
  entries["background-root.mjs"] = strToU8(background);
  entries["content-group-canary.mjs"] = strToU8(content);
  entries["popup.html"] = strToU8(POPUP_HTML);
  entries["popup.js"] = strToU8(POPUP_JS);
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);
  entries["README.txt"] = strToU8(
    `v${VERSION} SEO-UPLOAD SELECTION MODE\n` +
    `- A18 화면에 보이는 상품이 아니라 Commerce OS SEO 대량등록 → Shopling 업로드 작업을 목록으로 표시합니다.\n` +
    `- 동일 출시상품은 가장 최근 SEO 대량등록 Shopling 업로드만 선택 가능합니다.\n` +
    `- 사용자가 체크박스로 고른 상품만 마켓등록합니다.\n` +
    `- 여러 상품 선택 시 상품은 순차 처리하고, 각 상품은 최대 3채널 병렬로 3+3 처리합니다.\n` +
    `- 각 채널은 goods_key + 자사상품코드 이중일치 후 송신합니다.\n` +
    `- 한 번 시도한 채널은 같은 실행에서 무한 재시도하지 않고 예외로 남깁니다.\n` +
    `- sent/already_registered는 건너뛰고 confirm_needed는 자동 재송신하지 않습니다.\n`,
  );

  if (!background.includes(SELECTED_CLAIM_MESSAGE)) throw new Error("v039_selected_claim_message_missing");
  if (!background.includes("selection/claim")) throw new Error("v039_selected_claim_endpoint_missing");
  if (!content.includes(SELECTED_START_MESSAGE)) throw new Error("v039_selected_start_message_missing");
  if (!content.includes(SELECTION_QUEUE_KEY)) throw new Error("v039_selection_queue_missing");
  if (!content.includes("selectedCoordinatorTick")) throw new Error("v039_selection_coordinator_missing");
  if (!content.includes("excludeGoodsKeys")) throw new Error("v039_one_pass_exclusion_missing");
  if (!POPUP_JS.includes("selection/list")) throw new Error("v039_popup_selection_list_missing");
  if (!POPUP_HTML.includes("data-job-id") && !POPUP_JS.includes("data-job-id")) throw new Error("v039_checkbox_list_missing");
  if (content.includes("document.documentElement.appendChild(box)")) throw new Error("v039_shopling_dom_panel_present");
  assertScript("popup-v039", POPUP_JS);

  const archive = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename=commerce-os-shopling-market-sender-v${VERSION}.zip`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

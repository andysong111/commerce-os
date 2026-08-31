import { readFile } from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_VERSION = "0.3.4";
const VERSION = "0.3.6";
const CONTROL_START_MESSAGE = "commerce-os-shopling-parallel-control-start-v036";

function assertScript(name: string, source: string) {
  try {
    new Function(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "syntax error");
    throw new Error(`shopling_parallel_worker_${name}_invalid: ${message}`);
  }
}

function replaceOnce(source: string, anchor: string, replacement: string, errorCode: string) {
  const first = source.indexOf(anchor);
  if (first < 0) throw new Error(errorCode);
  if (source.indexOf(anchor, first + anchor.length) >= 0) throw new Error(`${errorCode}_ambiguous`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + anchor.length)}`;
}

function replaceBetween(source: string, start: string, end: string, replacement: string, errorCode: string) {
  const startAt = source.indexOf(start);
  if (startAt < 0) throw new Error(`${errorCode}_start_missing`);
  const endAt = source.indexOf(end, startAt + start.length);
  if (endAt < 0) throw new Error(`${errorCode}_end_missing`);
  return `${source.slice(0, startAt)}${replacement}${source.slice(endAt)}`;
}

function rewriteBackground(source: string) {
  const rewritten = replaceOnce(
    source,
    'const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV034";',
    'const WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV036";',
    "shopling_parallel_worker_v036_background_state_anchor_missing",
  );
  assertScript("background-root-v036", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = source;
  rewritten = replaceOnce(rewritten, 'const VERSION = "0.3.4";', 'const VERSION = "0.3.6";', "shopling_parallel_worker_v036_content_version_anchor_missing");
  rewritten = replaceOnce(rewritten, 'const RUN_STATE_KEY = "commerceOsShoplingParallelRunV034";', 'const RUN_STATE_KEY = "commerceOsShoplingParallelRunV036";', "shopling_parallel_worker_v036_run_state_anchor_missing");
  rewritten = replaceOnce(rewritten, 'const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV034";', 'const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV036";', "shopling_parallel_worker_v036_worker_state_anchor_missing");
  rewritten = replaceOnce(
    rewritten,
    '  const CONTEXT_MESSAGE = "commerce-os-shopling-parallel-worker-context";',
    `  const CONTEXT_MESSAGE = "commerce-os-shopling-parallel-worker-context";\n  const CONTROL_START_MESSAGE = "${CONTROL_START_MESSAGE}";\n  const CONTROL_UI_MODE = "extension-action-only-no-shopling-dom";`,
    "shopling_parallel_worker_v036_control_message_anchor_missing",
  );
  rewritten = replaceOnce(rewritten, "  const SUBMIT_CONFIRM_TIMEOUT_MS = 90000;", "  const SUBMIT_CONFIRM_TIMEOUT_MS = 90000;\n  const A18_NAVIGATION_TIMEOUT_MS = 20000;", "shopling_parallel_worker_v036_a18_timeout_anchor_missing");
  rewritten = replaceOnce(rewritten, '    if (!["worker_opening", "await_a18", "a18_clicked"].includes(state.stage)) return;', '    if (!["worker_opening", "await_a18"].includes(state.stage)) return;', "shopling_parallel_worker_v036_repeat_a18_gate_anchor_missing");

  const driveAnchor = `      if (isIdChoicePage()) { await driveIdChoice(state); return; }\n      if (isPreProdChoicePage()) { await drivePreProd(state); return; }\n      if (isProductListUi()) { await driveProductList(state); return; }\n      if (window.top === window && isAdminShell()) await navigateWorkerShell(state);`;
  const driveReplacement = `      if (isIdChoicePage()) { await driveIdChoice(state); return; }\n      if (isPreProdChoicePage()) { await drivePreProd(state); return; }\n      if (isProductListUi()) { await driveProductList(state); return; }\n      if (state.stage === "a18_clicked") {\n        const age = Date.now() - Number(state.stepAt || 0);\n        if (age >= A18_NAVIGATION_TIMEOUT_MS) {\n          await failTask(state, "a18_navigation_timeout", "A18 진입 클릭 후 상품등록 화면을 확인하지 못했습니다. 메뉴를 반복 클릭하지 않고 이 채널만 안전중단했습니다.");\n        }\n        return;\n      }\n      if (window.top === window && isAdminShell()) await navigateWorkerShell(state);`;
  rewritten = replaceOnce(rewritten, driveAnchor, driveReplacement, "shopling_parallel_worker_v036_drive_wait_anchor_missing");

  rewritten = replaceBetween(
    rewritten,
    "  function mount() {",
    "\n  chrome.storage.onChanged.addListener",
    `  function mount() {\n    return CONTROL_UI_MODE;\n  }\n`,
    "shopling_parallel_worker_v036_mount_block",
  );

  const startupAnchor = `  mount();\n  const observer = new MutationObserver(() => mount());\n  observer.observe(document.documentElement, { childList: true, subtree: true });\n  timer = setInterval(() => void drive(), 800);\n  panelTimer = setInterval(() => void refreshPanel(), 1200);\n  void drive();`;
  const startupReplacement = `  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {\n    if (!message || message.type !== CONTROL_START_MESSAGE || !isProductListUi()) return false;\n    startParallelCanary()\n      .then(() => sendResponse({ ok: true, version: VERSION }))\n      .catch((error) => sendResponse({ ok: false, error: "parallel_control_start_failed", message: error instanceof Error ? error.message : String(error || "start failed") }));\n    return true;\n  });\n\n  timer = setInterval(() => void drive(), 800);\n  panelTimer = null;\n  void drive();`;
  rewritten = replaceOnce(rewritten, startupAnchor, startupReplacement, "shopling_parallel_worker_v036_popup_startup_anchor_missing");

  assertScript("content-group-canary-v036", rewritten);
  return rewritten;
}

const POPUP_HTML = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shopling Parallel Worker</title>
<style>
body{width:360px;margin:0;padding:14px;font:13px/1.45 Arial,sans-serif;color:#0f172a;background:#fff;box-sizing:border-box}
h1{font-size:14px;margin:0 0 6px;color:#0f766e}p{margin:0 0 10px;color:#64748b}#status{padding:9px;border:1px solid #dbeafe;border-radius:8px;background:#f8fafc;margin-bottom:10px}button{width:100%;padding:10px;border:0;border-radius:8px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer}button:disabled{opacity:.55;cursor:default}.guard{font-size:11px;color:#64748b;margin-top:9px}
</style>
</head>
<body>
<h1>Parallel Fresh Worker v0.3.6</h1>
<p>A18 화면에는 어떤 패널도 올리지 않습니다. 아래 버튼은 현재 열려 있는 Shopling A18 탭에만 시작 신호를 보냅니다.</p>
<div id="status">상태 확인 중...</div>
<button id="start" type="button">남은 채널 병렬 처리 시작</button>
<div class="guard">goods_key + 자사상품코드 이중일치 · 채널별 독립잠금 · A18 진입 1회</div>
<script src="popup.js"></script>
</body>
</html>
`;

const POPUP_JS = `"use strict";
const VERSION = "0.3.6";
const START_MESSAGE = "${CONTROL_START_MESSAGE}";
const RUN_STATE_KEY = "commerceOsShoplingParallelRunV036";
const WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV036:";
const statusNode = document.getElementById("status");
const startButton = document.getElementById("start");

function text(value) { return String(value == null ? "" : value).replace(/\\s+/g, " ").trim(); }

async function activeShoplingTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs && tabs[0];
  if (!tab || !Number.isInteger(tab.id) || !/^https?:\\/\\/a\\.shopling\\.co\\.kr\\//i.test(String(tab.url || ""))) return null;
  return tab;
}

async function refresh() {
  const all = await chrome.storage.local.get(null);
  const run = all[RUN_STATE_KEY] || null;
  if (!run) {
    statusNode.textContent = "v" + VERSION + " · 새 실행 준비";
    startButton.disabled = false;
    return;
  }
  const states = Object.keys(all).filter(function (key) { return key.indexOf(WORKER_STATE_PREFIX + run.runId + ":") === 0; }).map(function (key) { return all[key]; }).filter(Boolean);
  const running = states.filter(function (row) { return row.status === "running"; }).length;
  const sent = states.filter(function (row) { return row.status === "completed" && row.outcome === "sent"; }).length;
  const skipped = states.filter(function (row) { return row.status === "completed" && row.outcome === "already_registered"; }).length;
  const failed = states.filter(function (row) { return row.status === "failed"; }).length;
  const confirm = states.filter(function (row) { return row.status === "confirm_needed"; }).length;
  statusNode.textContent = "v" + VERSION + " · " + text(run.status) + " · 실행 " + running + " · 성공 " + sent + " · 이미등록 " + skipped + " · 실패 " + failed + " · 확인필요 " + confirm;
  startButton.disabled = run.status === "opening" || run.status === "running" || run.status === "confirm_needed";
}

startButton.addEventListener("click", async function () {
  startButton.disabled = true;
  statusNode.textContent = "현재 A18 탭 확인 중...";
  const tab = await activeShoplingTab();
  if (!tab) {
    statusNode.textContent = "Shopling 관리자 A18 탭을 먼저 활성화하세요.";
    startButton.disabled = false;
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: START_MESSAGE }, function (response) {
    const lastError = chrome.runtime.lastError;
    if (lastError || !response || response.ok !== true) {
      statusNode.textContent = "A18 상품등록 화면을 찾지 못했습니다. A18 화면을 새로고침한 뒤 다시 누르세요.";
      startButton.disabled = false;
      return;
    }
    statusNode.textContent = "병렬 Worker 시작 신호를 전달했습니다.";
    setTimeout(refresh, 300);
  });
});

chrome.storage.onChanged.addListener(function () { refresh(); });
refresh();
`;

export async function GET() {
  const root = path.join(process.cwd(), "public", "shopling-market-group-canary");
  const entries: Record<string, Uint8Array> = {};
  const manifestSource = await readFile(path.join(root, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestSource) as { version?: string; description?: string; permissions?: string[]; content_scripts?: Array<{ js?: string[] }>; action?: Record<string, string> };
  if (manifest.version !== BASE_VERSION) throw new Error("shopling_parallel_worker_base_manifest_version_mismatch");
  if (manifest.permissions?.includes("contentSettings")) throw new Error("shopling_parallel_worker_obsolete_popup_permission_present");
  if (manifest.permissions?.includes("scripting")) throw new Error("shopling_parallel_worker_obsolete_launcher_script_permission_present");

  manifest.version = VERSION;
  manifest.description = "Shopling A18 DOM에 제어 패널을 전혀 삽입하지 않고 Chrome 확장 팝업에서만 병렬 등록을 시작하는 클릭충돌 제거 버전입니다.";
  manifest.action = { default_title: "Commerce OS Shopling Parallel Worker", default_popup: "popup.html" };
  manifest.content_scripts = (manifest.content_scripts || []).map((entry) => ({ ...entry, js: ["content-group-canary.mjs"] }));
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const backgroundSource = await readFile(path.join(root, "background-root.mjs"), "utf8");
  const contentSource = await readFile(path.join(root, "content-group-canary.mjs"), "utf8");
  entries["background-root.mjs"] = strToU8(rewriteBackground(backgroundSource));
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(contentSource));
  entries["popup.html"] = strToU8(POPUP_HTML);
  entries["popup.js"] = strToU8(POPUP_JS);

  const background = new TextDecoder().decode(entries["background-root.mjs"]);
  const content = new TextDecoder().decode(entries["content-group-canary.mjs"]);
  const popup = new TextDecoder().decode(entries["popup.js"]);
  if (!background.includes("chrome.tabs.duplicate")) throw new Error("shopling_parallel_worker_a18_duplicate_missing");
  if (!background.includes("Promise.allSettled")) throw new Error("shopling_parallel_worker_parallel_clone_missing");
  if (!background.includes("commerceOsShoplingParallelWorkerMetaV036")) throw new Error("shopling_parallel_worker_v036_background_state_isolation_missing");
  if (!background.includes("parallel: true")) throw new Error("shopling_parallel_worker_parallel_contract_missing");
  if (background.includes("clickManagerAccessOnLauncher")) throw new Error("shopling_parallel_worker_obsolete_manager_launcher_present");
  if (!background.includes("group-canary-release-v0.3.2")) throw new Error("shopling_parallel_worker_claim_release_missing");
  if (!content.includes("commerceOsShoplingParallelWorkerV036")) throw new Error("shopling_parallel_worker_v036_state_isolation_missing");
  if (!content.includes("commerceOsShoplingParallelRunV036")) throw new Error("shopling_parallel_worker_v036_run_isolation_missing");
  if (!content.includes("extension-action-only-no-shopling-dom")) throw new Error("shopling_parallel_worker_v036_no_dom_mode_missing");
  if (content.includes("document.documentElement.appendChild(box)")) throw new Error("shopling_parallel_worker_v036_shopling_dom_panel_present");
  if (!content.includes(CONTROL_START_MESSAGE)) throw new Error("shopling_parallel_worker_v036_control_listener_missing");
  if (content.includes('if (!["worker_opening", "await_a18", "a18_clicked"].includes(state.stage))')) throw new Error("shopling_parallel_worker_repeat_a18_click_gate_present");
  if (!content.includes("a18_navigation_timeout")) throw new Error("shopling_parallel_worker_a18_one_shot_timeout_missing");
  if (!content.includes("ignoredSelpaFailures")) throw new Error("shopling_parallel_worker_selfa_policy_missing");
  if (!content.includes("nonIgnoredFailure")) throw new Error("shopling_parallel_worker_nonselfa_failure_guard_missing");
  if (!popup.includes("chrome.tabs.sendMessage")) throw new Error("shopling_parallel_worker_v036_popup_send_missing");
  if (!popup.includes(CONTROL_START_MESSAGE)) throw new Error("shopling_parallel_worker_v036_popup_contract_missing");
  assertScript("popup-v036", popup);

  const readme = await readFile(path.join(root, "README.txt"), "utf8");
  entries["README.txt"] = strToU8(`v${VERSION} CLICK-SAFE HOTFIX\n- Shopling A18 페이지 안에는 제어 패널/버튼/오버레이를 0개 삽입합니다.\n- 확장프로그램 아이콘을 눌러 열린 popup에서만 병렬 작업을 시작합니다.\n- A18 페이지는 조회/검색/체크박스/버튼 클릭을 Shopling 원본 그대로 유지합니다.\n- 복제 Worker의 A18 메뉴 hover/click은 최초 1회만 수행합니다.\n- 20초 안에 A18 화면 전환이 확인되지 않으면 반복 클릭 대신 해당 채널만 안전중단합니다.\n\n${readme}`);
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Parallel Fresh Worker Canary v${VERSION}\n`);

  const archive = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(archive), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename=commerce-os-shopling-market-parallel-fresh-worker-canary-v${VERSION}.zip`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

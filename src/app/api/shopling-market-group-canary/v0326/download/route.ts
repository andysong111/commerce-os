import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0325Package } from "../../v0325/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.26";

function replaceRequired(source: string, anchor: string, replacement: string, code: string) {
  if (!source.includes(anchor)) throw new Error(code);
  return source.replace(anchor, replacement);
}
function replaceSection(source: string, start: string, end: string, replacement: string, code: string) {
  const a = source.indexOf(start); const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(code);
  return source.slice(0, a) + replacement + "\n\n" + source.slice(b);
}
function assertScript(name: string, source: string) {
  try { new Function(source); } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "syntax error");
    throw new Error(`shopling_market_sender_${name}_invalid: ${message}`);
  }
}
function rewriteRuntime(source: string) {
  return source.replaceAll("0.3.25", VERSION).replaceAll("V0325", "V0326").replaceAll("v0325", "v0326");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source)
    .replace('const SELECTED_CLAIM_API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/selection/claim";', 'const SELECTED_CLAIM_API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/selection/claim-all";')
    .replace('const SELECTED_BRIDGE = "shopling-market-selection-v0.1";', 'const SELECTED_BRIDGE = "shopling-market-selection-all-v0.1";')
    .replace('const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0324";', 'const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0325";')
    .replace('    maxTasks: 3,\n', '');

  rewritten = replaceRequired(
    rewritten,
    [
      '  const previous = await getWorkerMeta();',
      '  if (previous?.runId === runId && assignmentArray(previous).some((assignment) => assignment?.status === "active")) {',
      '    return {',
      '      ok: true,',
      '      resumed: true,',
      '      openedCount: assignmentArray(previous).filter((assignment) => assignment?.status === "active").length,',
      '      assignments: assignmentArray(previous),',
      '    };',
      '  }',
      '',
      '  const controlTabId = sender?.tab?.id ?? null;',
    ].join('\n'),
    [
      '  const previous = await getWorkerMeta();',
      '  const existingGoodsKeys = new Set(previous?.runId === runId ? assignmentArray(previous).map((assignment) => text(assignment?.goodsKey)).filter(Boolean) : []);',
      '  const tasksToOpen = tasks.filter((task) => !existingGoodsKeys.has(task.goodsKey));',
      '  if (!tasksToOpen.length) {',
      '    return { ok: true, resumed: true, openedCount: 0, assignments: assignmentArray(previous) };',
      '  }',
      '',
      '  const controlTabId = sender?.tab?.id ?? null;',
    ].join('\n'),
    'v0326_background_merge_same_run_missing',
  );

  rewritten = replaceRequired(
    rewritten,
    [
      '  await setWorkerMeta({',
      '    runId,',
      '    controlTabId,',
      '    controlWindowId,',
      '    assignments: {},',
      '    openedAt: Date.now(),',
      '    updatedAt: Date.now(),',
      '  });',
    ].join('\n'),
    [
      '  if (!previous || previous.runId !== runId) {',
      '    await setWorkerMeta({ runId, controlTabId, controlWindowId, assignments: {}, openedAt: Date.now(), updatedAt: Date.now() });',
      '  } else {',
      '    await setWorkerMeta({ ...previous, controlTabId: previous.controlTabId ?? controlTabId, controlWindowId: previous.controlWindowId ?? controlWindowId, updatedAt: Date.now() });',
      '  }',
    ].join('\n'),
    'v0326_background_meta_merge_missing',
  );
  rewritten = replaceRequired(rewritten, '    tasks.map(async (task) => {', '    tasksToOpen.map(async (task) => {', 'v0326_background_tasks_to_open_missing');
  rewritten = replaceRequired(rewritten, '    const task = tasks[index];', '    const task = tasksToOpen[index];', 'v0326_background_failed_task_index_missing');
  assertScript('background-v0326', rewritten);
  return rewritten;
}

const COORDINATOR = String.raw`async function selectedWaveStates(queue) {
    const tasks = Array.isArray(queue?.activeTasks) ? queue.activeTasks : [];
    if (!queue?.batchRunId || !tasks.length) return [];
    return (await Promise.all(tasks.map((task) => getWorkerState(queue.batchRunId, task.goodsKey)))).filter(Boolean);
  }

  function selectedRunResultForJob(jobId, summary, errorMessage = "") {
    const successCount = Number(summary?.sentCount || 0) + Number(summary?.alreadyRegisteredCount || 0);
    const confirmNeededCount = Number(summary?.confirmNeededCount || 0);
    const pendingCount = Number(summary?.pendingCount || 0);
    const busyCount = Number(summary?.busyCount || 0);
    return { jobId, status: errorMessage || confirmNeededCount > 0 || pendingCount > 0 || busyCount > 0 ? "exception" : "completed", successCount, confirmNeededCount, pendingCount, busyCount, error: errorMessage, finishedAt: Date.now() };
  }

  async function reconcileSelectedJob(queue, jobId) {
    const tasks = Array.isArray(queue?.jobTasks?.[jobId]) ? queue.jobTasks[jobId] : [];
    const server = await sendMessage({ type: SELECTED_STATUS_MESSAGE, jobId, goodsKeys: [] });
    if (!server?.ok) return { terminal: false, server, error: text(server?.message || server?.error) };
    const byKey = new Map((Array.isArray(server.rows) ? server.rows : []).map((row) => [text(row?.goodsKey), row]));
    for (const task of tasks) {
      const state = await getWorkerState(queue.batchRunId, task.goodsKey);
      if (!state || state.status !== "running") continue;
      const row = byKey.get(task.goodsKey); if (!row) continue;
      const serverStatus = text(row.status); const marketStatus = text(row.marketStatus); const reasonCode = text(row.reasonCode) || "server_full_parallel_reconciled_v0326"; const message = text(row.message) || (task.profile + " · 서버 원장 상태로 로컬 Worker를 복구했습니다.");
      if (serverStatus === "sent" || marketStatus === "sent") await patchWorkerState(state, { status: "completed", stage: "server_reconciled", outcome: "sent", reasonCode, message, finishedAt: Date.now() });
      else if (serverStatus === "already_registered" || marketStatus === "already_registered") await patchWorkerState(state, { status: "completed", stage: "server_reconciled", outcome: "already_registered", reasonCode, message, finishedAt: Date.now() });
      else if (serverStatus === "confirm_needed" || marketStatus === "confirm_needed") await patchWorkerState(state, { status: "confirm_needed", stage: "server_reconciled_confirm", reasonCode, message, finishedAt: Date.now() });
      else if (serverStatus === "queued" && marketStatus === "pending") await patchWorkerState(state, { status: "failed", stage: "server_reconciled_released", reasonCode, message, finishedAt: Date.now() });
    }
    const summary = server.summary || {};
    const terminal = Number(summary.rowCount || 0) >= 6 && Number(summary.terminalCount || 0) >= 6 && Number(summary.busyCount || 0) === 0 && Number(summary.pendingCount || 0) === 0;
    return { terminal, server, summary };
  }

  async function finishSelectionQueue(queue) {
    const results = Array.isArray(queue.results) ? queue.results : [];
    const hasException = results.some((row) => row?.status !== "completed");
    return saveSelectionQueue({ ...queue, status: hasException ? "completed_with_exceptions" : "completed", finishedAt: Date.now(), updatedAt: Date.now() });
  }

  async function selectedCoordinatorTick() {
    if (selectionCoordinating) return;
    selectionCoordinating = true;
    try {
      const context = await workerContext();
      if (context.worker) return;
      if (!isProductListUi()) { if (window.top === window && isAdminShell()) await navigateControlToA18ForIntent(); return; }
      await activateSelectionIntent();
      let queue = await getSelectionQueue();
      if (!queue || queue.status !== "running") return;
      if (!queue.batchRunId) queue = await saveSelectionQueue({ ...queue, batchRunId: newRunId(), launchedJobIds: [], jobTasks: {}, claimAttempts: {}, updatedAt: Date.now() });

      const results = Array.isArray(queue.results) ? [...queue.results] : [];
      const doneJobs = new Set(results.map((row) => text(row?.jobId)).filter(Boolean));
      let launched = new Set(Array.isArray(queue.launchedJobIds) ? queue.launchedJobIds : []);
      const jobTasks = { ...(queue.jobTasks || {}) };
      const claimAttempts = { ...(queue.claimAttempts || {}) };

      for (const jobId of [...launched]) {
        if (doneJobs.has(jobId)) continue;
        const reconciled = await reconcileSelectedJob({ ...queue, jobTasks }, jobId);
        if (reconciled.terminal) {
          results.push(selectedRunResultForJob(jobId, reconciled.summary)); doneJobs.add(jobId); continue;
        }
        const summary = reconciled.summary || {};
        const tasks = Array.isArray(jobTasks[jobId]) ? jobTasks[jobId] : [];
        const states = (await Promise.all(tasks.map((task) => getWorkerState(queue.batchRunId, task.goodsKey)))).filter(Boolean);
        const localBusy = states.some((state) => state.status === "running");
        if (!localBusy && Number(summary.busyCount || 0) === 0 && Number(summary.pendingCount || 0) > 0 && Number(claimAttempts[jobId] || 0) < 2) {
          launched.delete(jobId); delete jobTasks[jobId];
        }
      }

      const activeJobs = [...launched].filter((jobId) => !doneJobs.has(jobId)).length;
      const available = Math.max(0, MAX_PARALLEL_PRODUCTS - activeJobs);
      const candidates = queue.jobIds.filter((jobId) => !doneJobs.has(jobId) && !launched.has(jobId)).slice(0, available);
      for (const jobId of candidates) {
        claimAttempts[jobId] = Number(claimAttempts[jobId] || 0) + 1;
        const claim = await sendMessage({ type: SELECTED_CLAIM_MESSAGE, runId: queue.batchRunId, jobId, excludeGoodsKeys: [] });
        if (!claim?.ok) {
          results.push(selectedRunResultForJob(jobId, null, text(claim?.message || claim?.error || "선택 상품 전체병렬 claim 실패"))); doneJobs.add(jobId); continue;
        }
        const tasks = Array.isArray(claim.tasks) ? claim.tasks : [];
        launched.add(jobId); jobTasks[jobId] = tasks;
        if (!tasks.length) {
          if (claim.summary?.completed) { results.push(selectedRunResultForJob(jobId, claim.summary)); doneJobs.add(jobId); }
          continue;
        }
        await initializeWorkerStates(queue.batchRunId, tasks);
        const opened = await sendMessage({ type: OPEN_WORKERS_MESSAGE, runId: queue.batchRunId, tasks });
        if (!opened?.ok) {
          const states = await Promise.all(tasks.map((task) => getWorkerState(queue.batchRunId, task.goodsKey)));
          for (const state of states.filter(Boolean)) await patchWorkerState(state, { status: "failed", stage: "worker_open_failed", message: "전체병렬 A18 작업창 생성 실패: " + text(opened?.message || opened?.error) });
        }
      }

      const allTasks = Object.values(jobTasks).flat().filter(Boolean);
      queue = await saveSelectionQueue({ ...queue, launchedJobIds: [...launched], jobTasks, claimAttempts, activeTasks: allTasks, results, updatedAt: Date.now() });
      if (doneJobs.size >= queue.jobIds.length) await finishSelectionQueue(queue);
    } catch (error) {
      const queue = await getSelectionQueue();
      if (queue?.status === "running") await saveSelectionQueue({ ...queue, status: "completed_with_exceptions", fatalError: error instanceof Error ? error.message : String(error || "전체병렬 선택 등록 오류"), finishedAt: Date.now(), updatedAt: Date.now() });
    } finally { selectionCoordinating = false; }
  }`;

const START_QUEUE = String.raw`async function startSelectedQueue(rawJobIds) {
    const jobIds = selectedJobIds(rawJobIds);
    if (!jobIds.length) return { ok: false, error: "selected_shopling_jobs_required" };
    const existing = await getSelectionQueue();
    if (existing?.status === "running") return { ok: false, error: "selected_shopling_queue_already_running", message: "이미 선택 상품 마켓등록이 실행 중입니다." };
    const now = Date.now();
    await saveSelectionQueue({ version: VERSION, status: "running", jobIds, batchRunId: newRunId(), launchedJobIds: [], jobTasks: {}, claimAttempts: {}, activeTasks: [], results: [], waves: [], startedAt: now, updatedAt: now });
    await selectedCoordinatorTick();
    return { ok: true, version: VERSION, selectedCount: jobIds.length, parallelProducts: Math.min(jobIds.length, MAX_PARALLEL_PRODUCTS) };
  }`;

function rewriteContent(source: string) {
  let rewritten = rewriteRuntime(source)
    .replace('const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0324";', 'const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0325";')
    .replace('const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0324";', 'const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0325";')
    .replace('const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0324";', 'const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0325";')
    .replace('const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0324";', 'const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0325";');
  rewritten = replaceRequired(rewritten, '  const UNREGISTERED_RESULT_TIMEOUT_MS = 10000;', '  const UNREGISTERED_RESULT_TIMEOUT_MS = 10000;\n  const MAX_PARALLEL_PRODUCTS = 3;', 'v0326_parallel_product_cap_missing');
  rewritten = replaceRequired(rewritten, '    if (!all[SELECTION_QUEUE_KEY] && all[LEGACY_SELECTION_QUEUE_KEY]) writes[SELECTION_QUEUE_KEY] = { ...all[LEGACY_SELECTION_QUEUE_KEY], version: VERSION };', '    if (!all[SELECTION_QUEUE_KEY] && all[LEGACY_SELECTION_QUEUE_KEY]) { const legacyQueue = all[LEGACY_SELECTION_QUEUE_KEY]; writes[SELECTION_QUEUE_KEY] = legacyQueue?.status === "running" ? { ...legacyQueue, version: VERSION, status: "superseded_by_v0326", finishedAt: Date.now(), updatedAt: Date.now() } : { ...legacyQueue, version: VERSION }; }', 'v0326_legacy_queue_stop_missing');
  rewritten = replaceRequired(rewritten, [
      '    await saveSelectionQueue({','      version: VERSION,','      status: "running",','      jobIds,','      cursor: 0,','      activeRunId: "",','      activeJobId: "",','      activeModelNumber: "",','      activeTasks: [],','      attemptedGoodsKeys: [],','      results: [],','      waves: [],','      startedAt: now,','      updatedAt: now,','    });',
    ].join('\n'), '    await saveSelectionQueue({ version: VERSION, status: "running", jobIds, batchRunId: newRunId(), launchedJobIds: [], jobTasks: {}, claimAttempts: {}, activeTasks: [], results: [], waves: [], startedAt: now, updatedAt: now });', 'v0326_intent_queue_shape_missing');
  rewritten = replaceSection(rewritten, '  async function selectedWaveStates(queue) {', '  async function startSelectedQueue(rawJobIds) {', '  ' + COORDINATOR, 'v0326_coordinator_section_missing');
  rewritten = replaceSection(rewritten, '  async function startSelectedQueue(rawJobIds) {', '  function mount() {', '  ' + START_QUEUE, 'v0326_start_queue_section_missing');
  assertScript('content-v0326', rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = rewriteRuntime(source)
    .replace('const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0324";', 'const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0325";')
    .replace('const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0324";', 'const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0325";');
  rewritten = replaceRequired(rewritten, '    const total = Array.isArray(queue.jobIds) ? queue.jobIds.length : 0;\n    const current = Math.min(Number(queue.cursor || 0) + 1, total || 1);\n    const active = text(queue.activeModelNumber);\n    statusNode.textContent = "실행 중 · 상품 " + current + "/" + total + (active ? " · " + active : "") + " · 창을 닫아도 계속 처리됩니다.";', '    const total = Array.isArray(queue.jobIds) ? queue.jobIds.length : 0;\n    const results = Array.isArray(queue.results) ? queue.results : [];\n    const activeJobs = (Array.isArray(queue.launchedJobIds) ? queue.launchedJobIds : []).filter(function (jobId) { return !results.some(function (row) { return row && row.jobId === jobId; }); }).length;\n    statusNode.textContent = "전체병렬 실행 중 · 완료 " + results.length + "/" + total + " · 동시상품 " + activeJobs + " · 상품당 최대 6채널 동시";', 'v0326_popup_parallel_status_missing');
  assertScript('popup-v0326', rewritten); return rewritten;
}

export async function GET() {
  const response = await getV0325Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0325_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const manifest = JSON.parse(strFromU8(entries['manifest.json'])) as { version?: string; description?: string };
  if (manifest.version !== '0.3.25') throw new Error('shopling_market_sender_v0326_source_version_mismatch');
  manifest.version = VERSION;
  manifest.description = '선택 상품을 상품별 순차가 아니라 동시에 실행하고, 상품 1개당 도매1~소매2 최대 6채널을 한 번에 병렬 처리하는 내부 운영 버전입니다.';
  entries['manifest.json'] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  entries['background-root.mjs'] = strToU8(rewriteBackground(strFromU8(entries['background-root.mjs'])));
  entries['content-group-canary.mjs'] = strToU8(rewriteContent(strFromU8(entries['content-group-canary.mjs'])));
  entries['popup.js'] = strToU8(rewritePopup(strFromU8(entries['popup.js'])));
  entries['popup.html'] = strToU8(rewriteRuntime(strFromU8(entries['popup.html'])).replace('상품은 순차 처리 · 상품 1개당 최대 3채널 병렬(3+3)', '선택상품 동시 처리 · 상품 1개당 최대 6채널 동시 · 전역 최대 3상품(18채널) 병렬'));
  entries['VERSION.txt'] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);
  const previousReadme = strFromU8(entries['README.txt'] || new Uint8Array());
  entries['README.txt'] = strToU8(`v0.3.26 FULL PARALLEL SELECTION\n- 선택 상품을 더 이상 상품별 순차 처리하지 않습니다. 최대 3상품을 동시에 실행하고 완료 즉시 다음 상품을 채웁니다.\n- 각 상품은 도매1~소매2의 미완료 채널을 최대 6개 한 번에 같은 run_id로 claim하여 모두 병렬 처리합니다.\n- 2상품 선택이면 최대 12개 작업창이 동시에 실행됩니다. 전역 상한은 Chrome 안정성을 위해 18채널입니다.\n- goods_key 단위 원장 잠금과 submit_armed 영구경계는 유지되어 같은 채널 중복송신을 방지합니다.\n- v0.3.25의 실행중 로컬 queue는 새 구조로 자동 재개하지 않고 서버 원장을 기준으로 새로 선택하도록 종료 처리합니다.\n\n${previousReadme}`);
  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename=commerce-os-shopling-market-sender-v0.3.26.zip', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

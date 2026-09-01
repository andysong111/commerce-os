import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0315Package } from "../../v0315/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.16";

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

function rewriteRuntime(source: string) {
  return source
    .replaceAll("0.3.15", VERSION)
    .replaceAll("V0315", "V0316")
    .replaceAll("v0315", "v0316");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = replaceOnce(
    rewritten,
    `const SELECTED_BRIDGE = "shopling-market-selection-v0.1";`,
    `const SELECTED_BRIDGE = "shopling-market-selection-v0.1";\nconst RESULT_CONTEXT_MESSAGE = "commerce-os-shopling-result-server-context-v0316";\nconst RESULT_CONTEXT_API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/result/context";\nconst RESULT_CONTEXT_BRIDGE = "shopling-market-result-context-v0.1";`,
    "v0316_background_result_context_constants_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `function releaseApi(runId, reasonCode, message) {`,
    `function resultContextApi(rawCandidateGoodsKeys) {\n  const candidateGoodsKeys = normalizeVisibleGoodsKeys(rawCandidateGoodsKeys);\n  return requestJson(RESULT_CONTEXT_API_ENDPOINT, {\n    bridge: RESULT_CONTEXT_BRIDGE,\n    candidateGoodsKeys,\n  });\n}\n\nfunction releaseApi(runId, reasonCode, message) {`,
    "v0316_background_result_context_api_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `async function verifyWorkerMessage(runId, goodsKey, sender) {`,
    `async function recoverServerWorkerContext(sender, rawCandidateGoodsKeys) {\n  if (!sender?.tab || !Number.isInteger(sender.tab.id) || !Number.isInteger(sender.tab.windowId)) {\n    return { worker: false, control: false };\n  }\n  const candidateGoodsKeys = normalizeVisibleGoodsKeys(rawCandidateGoodsKeys);\n  if (!candidateGoodsKeys.length) return { worker: false, control: false };\n  const response = await resultContextApi(candidateGoodsKeys);\n  if (!response?.ok || !Array.isArray(response.contexts) || response.contexts.length !== 1) {\n    return { worker: false, control: false, error: text(response?.error || "result_context_not_unique") };\n  }\n  const recovered = response.contexts[0] || null;\n  const runId = text(recovered?.runId);\n  const task = normalizeTask(recovered?.task);\n  if (!validRunId(runId) || !task || !candidateGoodsKeys.includes(task.goodsKey)) {\n    return { worker: false, control: false, error: "result_context_payload_invalid" };\n  }\n\n  const now = Date.now();\n  const assignment = {\n    goodsKey: task.goodsKey,\n    task,\n    rootWindowId: sender.tab.windowId,\n    rootTabId: sender.tab.id,\n    windowIds: [sender.tab.windowId],\n    tabIds: [sender.tab.id],\n    status: "active",\n    openedAt: now,\n    updatedAt: now,\n    serverRecovered: true,\n  };\n  const current = await getWorkerMeta();\n  if (current?.runId === runId) {\n    await setWorkerMeta({\n      ...current,\n      assignments: { ...(current.assignments || {}), [task.goodsKey]: assignment },\n      updatedAt: now,\n    });\n  } else {\n    await setWorkerMeta({\n      runId,\n      controlTabId: null,\n      controlWindowId: null,\n      assignments: { [task.goodsKey]: assignment },\n      openedAt: now,\n      updatedAt: now,\n      serverRecovered: true,\n    });\n  }\n  return {\n    worker: true,\n    control: false,\n    runId,\n    goodsKey: task.goodsKey,\n    task,\n    serverRecovered: true,\n  };\n}\n\nasync function verifyWorkerMessage(runId, goodsKey, sender) {`,
    "v0316_background_server_recovery_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  if (message.type === CONTEXT_MESSAGE) {\n    recordWorkerContext(sender, true, message.candidateGoodsKeys).then(sendResponse).catch(() => sendResponse({ worker: false, control: false }));\n    return true;\n  }`,
    `  if (message.type === CONTEXT_MESSAGE) {\n    recordWorkerContext(sender, true, message.candidateGoodsKeys).then(sendResponse).catch(() => sendResponse({ worker: false, control: false }));\n    return true;\n  }\n\n  if (message.type === RESULT_CONTEXT_MESSAGE) {\n    recoverServerWorkerContext(sender, message.candidateGoodsKeys).then(sendResponse).catch((error) => sendResponse({\n      worker: false,\n      control: false,\n      error: "result_context_server_recovery_failed",\n      message: String(error?.message || error),\n    }));\n    return true;\n  }`,
    "v0316_background_result_context_listener_missing",
  );

  assertScript("background-v0316", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = replaceOnce(
    rewritten,
    `  const CONTEXT_MESSAGE = "commerce-os-shopling-parallel-worker-context";`,
    `  const CONTEXT_MESSAGE = "commerce-os-shopling-parallel-worker-context";\n  const RESULT_CONTEXT_MESSAGE = "commerce-os-shopling-result-server-context-v0316";`,
    "v0316_content_result_context_message_missing",
  );

  const oldWorkerContext = `  async function workerContext() {\n    const response = await sendMessage({\n      type: CONTEXT_MESSAGE,\n      candidateGoodsKeys: resultContextGoodsKeys(),\n    });\n    return response || { worker: false, control: false };\n  }`;
  const newWorkerContext = `  async function workerContext() {\n    const candidateGoodsKeys = resultContextGoodsKeys();\n    const local = await sendMessage({\n      type: CONTEXT_MESSAGE,\n      candidateGoodsKeys,\n    });\n    if (local?.worker) return local;\n    if (candidateGoodsKeys.length) {\n      const recovered = await sendMessage({\n        type: RESULT_CONTEXT_MESSAGE,\n        candidateGoodsKeys,\n      });\n      if (recovered?.worker) return recovered;\n    }\n    return local || { worker: false, control: false };\n  }`;
  rewritten = replaceOnce(rewritten, oldWorkerContext, newWorkerContext, "v0316_content_server_context_worker_missing");

  rewritten = replaceOnce(
    rewritten,
    `  async function initializeWorkerStates(runId, tasks) {`,
    `  async function ensureResultWorkerState(context) {\n    if (!context?.worker || !context.runId || !context.goodsKey || !context.task) return null;\n    let state = await getWorkerState(context.runId, context.goodsKey);\n    if (state) return state;\n    if (!isSubmitResultPage() && !isMallResultFrame()) return null;\n    const now = Date.now();\n    state = {\n      version: VERSION,\n      runId: context.runId,\n      task: context.task,\n      status: "running",\n      stage: "submit_clicked",\n      startedAt: now,\n      stepAt: now,\n      submitArmedAt: now,\n      submitClickedAt: now,\n      message: context.task.profile + " · Commerce OS 서버 원장에서 결과 Worker 상태를 복구했습니다.",\n      serverRecovered: true,\n      updatedAt: now,\n    };\n    await saveWorkerState(state);\n    return state;\n  }\n\n  async function initializeWorkerStates(runId, tasks) {`,
    "v0316_content_result_state_hydration_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `      let state = await getWorkerState(context.runId, context.goodsKey);\n      if (!state || state.status !== "running") return;`,
    `      let state = await getWorkerState(context.runId, context.goodsKey);\n      if (!state) state = await ensureResultWorkerState(context);\n      if (!state || state.status !== "running") return;`,
    "v0316_content_drive_result_state_recovery_missing",
  );

  assertScript("content-v0316", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0315Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0315_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.15") throw new Error("shopling_market_sender_v0316_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "Commerce OS 서버 원장을 이용해 확장 재설치/로컬상태 유실 후에도 열린 Shopling 결과창에서 Worker 문맥과 submit 상태를 복구해 sent/confirm_needed를 확정하는 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  const background = rewriteBackground(strFromU8(entries["background-root.mjs"]));
  const content = rewriteContent(strFromU8(entries["content-group-canary.mjs"]));
  const popup = rewriteRuntime(strFromU8(entries["popup.js"]));
  const popupHtml = rewriteRuntime(strFromU8(entries["popup.html"]));

  entries["background-root.mjs"] = strToU8(background);
  entries["content-group-canary.mjs"] = strToU8(content);
  entries["popup.js"] = strToU8(popup);
  entries["popup.html"] = strToU8(popupHtml);
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);
  entries["README.txt"] = strToU8(
    `v${VERSION} SERVER-BACKED RESULT RECOVERY\n` +
    `- 확장프로그램 로컬 storage가 비어 있어도 Shopling 결과 페이지의 goods_key를 Commerce OS 서버 원장과 대조합니다.\n` +
    `- 서버 원장에 claimed + submit_armed 상태인 최근 작업이 정확히 1개 일치할 때만 runId/task를 복구합니다.\n` +
    `- 복구한 결과 Worker는 로컬 상태를 submit_clicked로 안전하게 재구성하고 기존 결과판정 로직으로 sent/confirm_needed를 기록합니다.\n` +
    `- 확장 업데이트/재설치 중 결과창이 이미 열려 있어도 background가 결과 탭을 다시 스캔하고 실행기를 주입합니다.\n` +
    `- 결과가 모호하면 자동 sent 처리하지 않고 기존 confirm_needed 정책을 유지합니다.\n\n` +
    strFromU8(entries["README.txt"]),
  );

  for (const [name, value] of [["background", background], ["content", content], ["popup", popup]] as const) assertScript(`${name}-v0316`, value);
  if (!background.includes("RESULT_CONTEXT_API_ENDPOINT")) throw new Error("v0316_result_context_api_missing");
  if (!background.includes("recoverServerWorkerContext")) throw new Error("v0316_server_context_recovery_missing");
  if (!background.includes("serverRecovered: true")) throw new Error("v0316_server_recovered_assignment_missing");
  if (!content.includes("ensureResultWorkerState")) throw new Error("v0316_result_worker_state_missing");
  if (!content.includes("RESULT_CONTEXT_MESSAGE")) throw new Error("v0316_content_result_context_message_missing");
  if (content.includes("document.documentElement.appendChild(box)")) throw new Error("v0316_shopling_dom_panel_present");

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

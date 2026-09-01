import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0319Package } from "../../v0319/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.20";

function replaceRequired(source: string, anchor: string, replacement: string, code: string) {
  if (!source.includes(anchor)) throw new Error(code);
  return source.replace(anchor, replacement);
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
    .replaceAll("0.3.19", VERSION)
    .replaceAll("V0319", "V0320")
    .replaceAll("v0319", "v0320");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = rewritten.replace(
    `const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0318";`,
    `const LEGACY_WORKER_META_KEY = "commerceOsShoplingParallelWorkerMetaV0319";`,
  );

  rewritten = replaceRequired(
    rewritten,
    `const SELECTED_BRIDGE = "shopling-market-selection-v0.1";`,
    `const SELECTED_BRIDGE = "shopling-market-selection-v0.1";\nconst SELECTED_STATUS_MESSAGE = "commerce-os-shopling-selected-status-v0320";\nconst SELECTED_STATUS_API_ENDPOINT = "https://commerce-os-ops-center.vercel.app/api/shopling-market-group-canary/selection/status";\nconst SELECTED_STATUS_BRIDGE = "shopling-market-selection-status-v0.1";`,
    "v0320_background_status_constants_missing",
  );

  const selectedClaimBlock = `function selectedClaimApi(runId, jobId, excludeGoodsKeys) {\n  return requestJson(SELECTED_CLAIM_API_ENDPOINT, {\n    bridge: SELECTED_BRIDGE,\n    runId,\n    jobId: text(jobId),\n    maxTasks: 3,\n    excludeGoodsKeys: Array.isArray(excludeGoodsKeys) ? excludeGoodsKeys.map(text) : [],\n  });\n}`;
  rewritten = replaceRequired(
    rewritten,
    selectedClaimBlock,
    `${selectedClaimBlock}\n\nfunction selectedStatusApi(jobId, goodsKeys) {\n  return requestJson(SELECTED_STATUS_API_ENDPOINT, {\n    bridge: SELECTED_STATUS_BRIDGE,\n    jobId: text(jobId),\n    goodsKeys: Array.isArray(goodsKeys) ? goodsKeys.map(text) : [],\n  });\n}`,
    "v0320_background_status_api_missing",
  );

  rewritten = replaceRequired(
    rewritten,
    `  if (message.type === OPEN_WORKERS_MESSAGE) {`,
    `  if (message.type === SELECTED_STATUS_MESSAGE) {\n    selectedStatusApi(message.jobId, message.goodsKeys).then(sendResponse).catch((error) => sendResponse({\n      ok: false,\n      error: "selected_shopling_status_exception",\n      message: String(error?.message || error),\n    }));\n    return true;\n  }\n\n  if (message.type === OPEN_WORKERS_MESSAGE) {`,
    "v0320_background_status_listener_missing",
  );

  assertScript("background-v0320", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = rewritten
    .replace(`const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0318";`, `const LEGACY_RUN_STATE_KEY = "commerceOsShoplingParallelRunV0319";`)
    .replace(`const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0318";`, `const LEGACY_WORKER_STATE_PREFIX = "commerceOsShoplingParallelWorkerV0319";`)
    .replace(`const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0318";`, `const LEGACY_SELECTION_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0319";`)
    .replace(`const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0318";`, `const LEGACY_SELECTION_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0319";`);

  rewritten = replaceRequired(
    rewritten,
    `  const SELECTED_CLAIM_MESSAGE = "commerce-os-shopling-selected-claim-v0320";`,
    `  const SELECTED_CLAIM_MESSAGE = "commerce-os-shopling-selected-claim-v0320";\n  const SELECTED_STATUS_MESSAGE = "commerce-os-shopling-selected-status-v0320";`,
    "v0320_content_status_constant_missing",
  );

  const oldActiveWave = `      if (queue.activeRunId) {\n        const states = await selectedWaveStates(queue);\n        if (states.some((state) => state.status === "running")) return;\n        const wave = {`;

  const newActiveWave = `      if (queue.activeRunId) {\n        let states = await selectedWaveStates(queue);\n        if (states.some((state) => state.status === "running")) {\n          const goodsKeys = (Array.isArray(queue.activeTasks) ? queue.activeTasks : []).map((task) => text(task?.goodsKey)).filter(Boolean);\n          const server = await sendMessage({\n            type: SELECTED_STATUS_MESSAGE,\n            jobId: queue.jobIds[queue.cursor],\n            goodsKeys,\n          });\n          if (server?.ok && Array.isArray(server.rows)) {\n            const byKey = new Map(server.rows.map((row) => [text(row?.goodsKey), row]));\n            for (const state of states.filter((row) => row?.status === "running")) {\n              const row = byKey.get(text(state?.task?.goodsKey));\n              if (!row) continue;\n              const serverStatus = text(row.status);\n              const marketStatus = text(row.marketStatus);\n              const reasonCode = text(row.reasonCode) || "server_wave_reconciled_v0320";\n              const message = text(row.message) || (state.task.profile + " · Commerce OS 서버 원장 상태로 로컬 Worker를 복구했습니다.");\n              if (serverStatus === "sent" || marketStatus === "sent") {\n                await patchWorkerState(state, { status: "completed", stage: "server_reconciled", outcome: "sent", reasonCode, message, finishedAt: Date.now() });\n              } else if (serverStatus === "already_registered" || marketStatus === "already_registered") {\n                await patchWorkerState(state, { status: "completed", stage: "server_reconciled", outcome: "already_registered", reasonCode, message, finishedAt: Date.now() });\n              } else if (serverStatus === "confirm_needed" || marketStatus === "confirm_needed") {\n                await patchWorkerState(state, { status: "confirm_needed", stage: "server_reconciled_confirm", reasonCode, message, finishedAt: Date.now() });\n              } else if (serverStatus === "queued" && marketStatus === "pending") {\n                await patchWorkerState(state, { status: "failed", stage: "server_reconciled_released", reasonCode, message, finishedAt: Date.now() });\n              }\n            }\n            states = await selectedWaveStates(queue);\n          }\n        }\n        if (states.some((state) => state.status === "running")) return;\n        const wave = {`;

  rewritten = replaceRequired(
    rewritten,
    oldActiveWave,
    newActiveWave,
    "v0320_content_server_wave_reconcile_missing",
  );

  assertScript("content-v0320", rewritten);
  return rewritten;
}

function rewritePopup(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = rewritten
    .replace(`const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0317";`, `const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0319";`)
    .replace(`const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0317";`, `const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0319";`)
    .replace(`const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0318";`, `const LEGACY_QUEUE_KEY = "commerceOsShoplingMarketSelectionQueueV0319";`)
    .replace(`const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0318";`, `const LEGACY_INTENT_KEY = "commerceOsShoplingMarketSelectionIntentV0319";`);
  assertScript("popup-v0320", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0319Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0319_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.19") throw new Error("shopling_market_sender_v0320_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "Commerce OS 서버 원장을 3+3 wave의 최종 진실로 재대조해 로컬 처리중 상태가 남아도 완료된 1차 wave를 복구하고 다음 3채널을 자동 이어가는 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["popup.js"] = strToU8(rewritePopup(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(rewriteRuntime(strFromU8(entries["popup.html"])));
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.20 SERVER WAVE RECONCILIATION\n` +
    `- 관리자 A18 원본은 계속 1개만 사용합니다. 두 번째 관리자 창은 필요하지 않습니다.\n` +
    `- 1차 3채널 결과가 서버 원장에는 sent/already_registered/confirm_needed로 확정됐는데 로컬 Worker만 처리중으로 남으면 서버 상태로 자동 복구합니다.\n` +
    `- 복구 직후 같은 상품의 남은 도매4/소매1/소매2 wave를 자동 claim하여 3+3 흐름을 이어갑니다.\n` +
    `- cassnet 결과 frame 직접 수집과 빈 A18 자동검색은 v0.3.19/v0.3.18 동작을 그대로 유지합니다.\n` +
    `- v0.3.19 queue/worker/meta를 이관해 업데이트 중인 실행을 이어받습니다.\n\n` +
    previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.20.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

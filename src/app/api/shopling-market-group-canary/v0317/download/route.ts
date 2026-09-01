import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { GET as getV0316Package } from "../../v0316/download/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION = "0.3.17";

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
    .replaceAll("0.3.16", VERSION)
    .replaceAll("V0316", "V0317")
    .replaceAll("v0316", "v0317");
}

function rewriteBackground(source: string) {
  let rewritten = rewriteRuntime(source);
  rewritten = replaceOnce(
    rewritten,
    `      && !/\\/prod_a\\/prod_rgst_rspt\\.phtml$/i.test(parsed.pathname);`,
    `      && !/\\/prod_a\\/prod_rgst_(?:rspt|tsrmt)\\.phtml$/i.test(parsed.pathname);`,
    "v0317_background_result_control_guard_missing",
  );
  assertScript("background-v0317", rewritten);
  return rewritten;
}

function rewriteContent(source: string) {
  let rewritten = rewriteRuntime(source);

  rewritten = replaceOnce(
    rewritten,
    `  const RESULT_CONTEXT_MESSAGE = "commerce-os-shopling-result-server-context-v0317";`,
    `  const RESULT_CONTEXT_MESSAGE = "commerce-os-shopling-result-server-context-v0317";\n  const RESULT_FRAME_MESSAGE = "commerce-os-shopling-result-frame-evidence-v0317";`,
    "v0317_content_frame_message_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  const A18_NAVIGATION_TIMEOUT_MS = 20000;`,
    `  const A18_NAVIGATION_TIMEOUT_MS = 20000;\n  const ADMIN_SHELL_TIMEOUT_MS = 15000;`,
    "v0317_content_admin_timeout_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  let selectionCoordinating = false;`,
    `  let selectionCoordinating = false;\n  const resultFrameBus = new Map();`,
    "v0317_content_result_bus_missing",
  );

  const oldStoreEvidence = `  async function storeMallResultEvidence(state) {\n    if (!isMallResultFrame()) return false;\n    const body = bodyText();\n    if (!/성공건수|실패건수|성공여부|상품 등록 전송 결과/i.test(body)) return false;\n    const successCount = countFrom(body, /성공건수\\s*[:：]?\\s*([\\d,]+)/i);\n    const failureCount = countFrom(body, /실패건수\\s*[:：]?\\s*([\\d,]+)/i);\n    const success = successCount > 0 || /성공여부\\s*성공/i.test(body);\n    const failure = failureCount > 0 || /성공여부\\s*실패/i.test(body);\n    const isSelpa = /셀파/i.test(body);\n    const frameId = encodeURIComponent([location.hostname, location.pathname, location.search].join("|")).slice(0, 500);\n    await storageSet({\n      [resultEvidenceKey(state.runId, state.task.goodsKey, frameId)]: {\n        runId: state.runId,\n        goodsKey: state.task.goodsKey,\n        frameId,\n        isSelpa,\n        success,\n        failure,\n        successCount,\n        failureCount,\n        capturedAt: Date.now(),\n      },\n    });\n    return true;\n  }`;

  const newStoreEvidence = `  async function storeMallResultEvidence(state) {\n    const evidence = mallResultSnapshot();\n    if (!evidence) return false;\n    broadcastMallResultEvidence(evidence);\n    if (evidence.goodsKey !== state.task.goodsKey) return false;\n    await storageSet({\n      [resultEvidenceKey(state.runId, state.task.goodsKey, evidence.frameId)]: {\n        ...evidence,\n        runId: state.runId,\n      },\n    });\n    return true;\n  }`;
  rewritten = replaceOnce(rewritten, oldStoreEvidence, newStoreEvidence, "v0317_content_store_evidence_missing");

  const oldCollected = `  async function collectedMallEvidence(state) {\n    const all = await storageGet(null);\n    const prefix = \`commerceOsShoplingParallelResultV0317:\${state.runId}:\${state.task.goodsKey}:\`;\n    return Object.keys(all)\n      .filter((key) => key.startsWith(prefix))\n      .map((key) => all[key])\n      .filter(Boolean);\n  }`;

  const newCollected = `  async function collectedMallEvidence(state) {\n    const all = await storageGet(null);\n    const prefix = \`commerceOsShoplingParallelResultV0317:\${state.runId}:\${state.task.goodsKey}:\`;\n    const merged = new Map();\n    for (const key of Object.keys(all).filter((key) => key.startsWith(prefix))) {\n      const row = all[key];\n      if (row?.frameId) merged.set(row.frameId, row);\n    }\n    for (const row of resultFrameBus.values()) {\n      if (row?.goodsKey === state.task.goodsKey && row?.frameId) merged.set(row.frameId, row);\n    }\n    return [...merged.values()];\n  }`;
  rewritten = replaceOnce(rewritten, oldCollected, newCollected, "v0317_content_collect_evidence_missing");

  const oldResultKeys = `  function resultContextGoodsKeys() {\n    if (!isSubmitResultPage() && !isMallResultFrame()) return [];\n    const body = bodyText();\n    return [...new Set([...body.matchAll(/(?:^|\\D)(\\d{5,9})(?=\\D|$)/g)].map((match) => match[1]))].slice(0, 20);\n  }`;

  const resultHelpers = `  function exactMallResultGoodsKey() {\n    if (!isMallResultFrame()) return "";\n    for (const table of document.querySelectorAll("table")) {\n      const rows = [...table.querySelectorAll("tr")];\n      for (let index = 0; index < rows.length; index += 1) {\n        const headerCells = [...rows[index].querySelectorAll(":scope > th, :scope > td")];\n        const goodsIndex = headerCells.findIndex((cell) => /^상품번호$/i.test(text(cell.textContent)));\n        if (goodsIndex < 0) continue;\n        for (let next = index + 1; next < Math.min(rows.length, index + 4); next += 1) {\n          const cells = [...rows[next].querySelectorAll(":scope > th, :scope > td")];\n          const value = text(cells[goodsIndex]?.textContent);\n          if (/^\\d{5,9}$/.test(value)) return value;\n        }\n      }\n    }\n    return "";\n  }\n\n  function mallResultSnapshot() {\n    if (!isMallResultFrame()) return null;\n    const body = bodyText();\n    if (!/성공건수|실패건수|성공여부|상품 등록 전송 결과/i.test(body)) return null;\n    const goodsKey = exactMallResultGoodsKey();\n    if (!goodsKey) return null;\n    const successCount = countFrom(body, /성공건수\\s*[:：]?\\s*([\\d,]+)/i);\n    const failureCount = countFrom(body, /실패건수\\s*[:：]?\\s*([\\d,]+)/i);\n    return {\n      goodsKey,\n      frameId: encodeURIComponent([location.hostname, location.pathname, location.search].join("|")).slice(0, 500),\n      isSelpa: /셀파/i.test(body),\n      success: successCount > 0 || /성공여부\\s*성공/i.test(body),\n      failure: failureCount > 0 || /성공여부\\s*실패/i.test(body),\n      successCount,\n      failureCount,\n      capturedAt: Date.now(),\n    };\n  }\n\n  function broadcastMallResultEvidence(snapshot = mallResultSnapshot()) {\n    if (!snapshot) return false;\n    try {\n      window.top.postMessage({ type: RESULT_FRAME_MESSAGE, evidence: snapshot }, "*");\n      return true;\n    } catch {\n      return false;\n    }\n  }\n\n  function resultContextGoodsKeys() {\n    if (!isSubmitResultPage() && !isMallResultFrame()) return [];\n    const exact = exactMallResultGoodsKey();\n    const body = bodyText();\n    const generic = [...body.matchAll(/(?:^|\\D)(\\d{5,9})(?=\\D|$)/g)].map((match) => match[1]);\n    const busKeys = isSubmitResultPage()\n      ? [...resultFrameBus.values()].map((row) => text(row?.goodsKey))\n      : [];\n    return [...new Set([exact, ...busKeys, ...generic].filter((value) => /^\\d{5,9}$/.test(value)))].slice(0, 20);\n  }`;
  rewritten = replaceOnce(rewritten, oldResultKeys, resultHelpers, "v0317_content_exact_result_key_missing");

  const oldWorkerContext = `  async function workerContext() {\n    const candidateGoodsKeys = resultContextGoodsKeys();\n    const local = await sendMessage({\n      type: CONTEXT_MESSAGE,\n      candidateGoodsKeys,\n    });\n    if (local?.worker) return local;\n    if (candidateGoodsKeys.length) {\n      const recovered = await sendMessage({\n        type: RESULT_CONTEXT_MESSAGE,\n        candidateGoodsKeys,\n      });\n      if (recovered?.worker) return recovered;\n    }\n    return local || { worker: false, control: false };\n  }`;

  const newWorkerContext = `  async function workerContext() {\n    const candidateGoodsKeys = resultContextGoodsKeys();\n    const local = await sendMessage({\n      type: CONTEXT_MESSAGE,\n      candidateGoodsKeys,\n    });\n    if (local?.worker) return local;\n    if (candidateGoodsKeys.length) {\n      const recovered = await sendMessage({\n        type: RESULT_CONTEXT_MESSAGE,\n        candidateGoodsKeys,\n      });\n      if (recovered?.worker) return recovered;\n    }\n    return local || { worker: false, control: false };\n  }`;
  rewritten = replaceOnce(rewritten, oldWorkerContext, newWorkerContext, "v0317_content_worker_context_missing");

  rewritten = replaceOnce(
    rewritten,
    `    try {\n      const context = await workerContext();`,
    `    try {\n      if (isMallResultFrame()) broadcastMallResultEvidence();\n      const context = await workerContext();`,
    "v0317_content_drive_broadcast_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `      if (window.top === window && isAdminShell()) await navigateWorkerShell(state);`,
    `      if (window.top === window && ["worker_opening", "await_a18"].includes(state.stage) && !isAdminShell()) {\n        const age = Date.now() - Number(state.stepAt || state.startedAt || 0);\n        if (age >= ADMIN_SHELL_TIMEOUT_MS) {\n          await failTask(state, "shopling_admin_shell_unavailable", "복제 작업창이 Shopling 관리자 로그인 화면을 유지하지 못해 송신 전에 이 채널만 원복했습니다.");\n        }\n        return;\n      }\n      if (window.top === window && isAdminShell()) await navigateWorkerShell(state);`,
    "v0317_content_admin_shell_guard_missing",
  );

  rewritten = replaceOnce(
    rewritten,
    `  chrome.storage.onChanged.addListener((changes, areaName) => {`,
    `  window.addEventListener("message", (event) => {\n    const data = event?.data;\n    if (!data || data.type !== RESULT_FRAME_MESSAGE || !data.evidence) return;\n    let hostname = "";\n    try { hostname = new URL(String(event.origin || "")).hostname; } catch { return; }\n    if (!/shopling\\.co\\.kr$/i.test(hostname)) return;\n    const row = data.evidence;\n    const goodsKey = text(row.goodsKey);\n    const frameId = text(row.frameId);\n    if (!/^\\d{5,9}$/.test(goodsKey) || !frameId) return;\n    resultFrameBus.set(goodsKey + "|" + frameId, {\n      goodsKey,\n      frameId,\n      isSelpa: row.isSelpa === true,\n      success: row.success === true,\n      failure: row.failure === true,\n      successCount: Number(row.successCount || 0),\n      failureCount: Number(row.failureCount || 0),\n      capturedAt: Number(row.capturedAt || Date.now()),\n    });\n  });\n\n  chrome.storage.onChanged.addListener((changes, areaName) => {`,
    "v0317_content_frame_listener_missing",
  );

  assertScript("content-v0317", rewritten);
  return rewritten;
}

export async function GET() {
  const response = await getV0316Package();
  if (!response.ok) throw new Error(`shopling_market_sender_v0316_source_http_${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));

  const manifest = JSON.parse(strFromU8(entries["manifest.json"])) as { version?: string; description?: string };
  if (manifest.version !== "0.3.16") throw new Error("shopling_market_sender_v0317_source_version_mismatch");
  manifest.version = VERSION;
  manifest.description = "Shopling 결과 프레임이 goods_key 기반 증거를 부모 결과창에 직접 전달해 3+3 병렬 송신의 sent/confirm_needed 자동확정을 강화하고 관리자 세션 이탈 Worker를 송신 전에 안전 원복하는 내부 운영 버전입니다.";
  entries["manifest.json"] = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);

  entries["background-root.mjs"] = strToU8(rewriteBackground(strFromU8(entries["background-root.mjs"])));
  entries["content-group-canary.mjs"] = strToU8(rewriteContent(strFromU8(entries["content-group-canary.mjs"])));
  entries["popup.js"] = strToU8(rewriteRuntime(strFromU8(entries["popup.js"])));
  entries["popup.html"] = strToU8(rewriteRuntime(strFromU8(entries["popup.html"])));
  entries["VERSION.txt"] = strToU8(`Commerce OS Shopling Market Sender v${VERSION}\n`);

  const previousReadme = strFromU8(entries["README.txt"] || new Uint8Array());
  entries["README.txt"] = strToU8(
    `v0.3.17 CROSS-FRAME RESULT RECONCILIATION\n` +
    `- 쇼핑몰별 결과 child frame이 상품번호(goods_key)와 성공/실패 증거를 부모 결과창으로 postMessage 전달합니다.\n` +
    `- 부모 결과창은 child frame 증거의 goods_key로 Commerce OS 서버 원장 문맥을 복구하고 전체 결과 frame이 모일 때만 sent를 확정합니다.\n` +
    `- 셀파 외 실패가 하나라도 있으면 기존 정책대로 confirm_needed이며, 일부 성공만으로 조기 sent 처리하지 않습니다.\n` +
    `- 복제 Worker가 관리자 세션을 잃고 일반 Shopling 화면으로 이탈하면 15초 뒤 송신 전 안전 원복합니다.\n` +
    `- 결과 tsrmt 창을 A18 원본 컨트롤 탭으로 오인하지 않도록 background URL guard를 보강했습니다.\n\n` +
    previousReadme,
  );

  const output = zipSync(entries, { level: 0 });
  return new Response(Buffer.from(output), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=commerce-os-shopling-market-sender-v0.3.17.zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
